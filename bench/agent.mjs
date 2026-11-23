// Shared by run.mjs and relay.mjs: arm settings overlays, scrubbed child env, headless claude launcher, stream parser.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { HERE } from './lib.mjs';

export const arms = JSON.parse(readFileSync(path.join(HERE, 'arms.json'), 'utf8'));
delete arms._comment;

export function buildSettings(name) {
  const arm = arms[name];
  if (!arm) throw new Error(`unknown arm: ${name}`);
  const userFile = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude'), 'settings.json');
  const user = JSON.parse(readFileSync(userFile, 'utf8'));
  const out = {};
  if (arm.hooks?.length) {
    out.hooks = {};
    for (const [event, groups] of Object.entries(user.hooks ?? {})) {
      const kept = groups
        .map((g) => ({ ...g, hooks: g.hooks.filter((h) => arm.hooks.some((s) => h.command?.includes(s))) }))
        .filter((g) => g.hooks.length);
      if (kept.length) out.hooks[event] = kept;
    }
    if (!Object.keys(out.hooks).length) throw new Error(`arm ${name}: no hook in ${userFile} contains any of ${arm.hooks}`);
  }
  if (arm.plugins?.length) {
    out.enabledPlugins = Object.fromEntries(arm.plugins.map((p) => [p, true]));
    out.pluginConfigs = Object.fromEntries(arm.plugins.filter((p) => user.pluginConfigs?.[p]).map((p) => [p, user.pluginConfigs[p]]));
  }
  if (arm.env?.length) out.env = Object.fromEntries(arm.env.filter((k) => user.env?.[k] !== undefined).map((k) => [k, user.env[k]]));
  return out;
}


// Keep auth, drop everything that would route the child through this session's proxy/model/session state.
export function childEnv() {
  const drop = /^(ANTHROPIC_|_CLAUDE_CODE_|CLAUDECODE$|CLAUDE_CODE_(SESSION|CHILD|MESSAGING|ENTRYPOINT|EXECPATH|USE_)|CLAUDE_PID$|CLAUDE_EFFORT$|AI_AGENT$)/;
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !drop.test(k) || k === 'ANTHROPIC_API_KEY' || k === 'ANTHROPIC_AUTH_TOKEN'));
}


// Runs one headless claude session and returns its raw stream-json output.
export function spawnClaude({ cwd, prompt, settingsFile, model, effort, budgetUsd }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--setting-sources', 'project', '--settings', settingsFile,
    '--strict-mcp-config', '--model', model, '--effort', effort, '--permission-mode', 'bypassPermissions', '--max-budget-usd', String(budgetUsd)];
  const started = Date.now();
  const r = spawnSync('claude', args, { cwd, input: prompt, env: childEnv(), encoding: 'utf8', timeout: 25 * 60_000, maxBuffer: 1 << 29 });
  return { raw: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status, wallMs: Date.now() - started };
}

export function parseStream(raw) {
  const events = raw.split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const result = events.findLast((e) => e.type === 'result');
  const tools = {};
  for (const e of events) if (e.type === 'assistant') for (const b of e.message?.content ?? []) if (b.type === 'tool_use') tools[b.name] = (tools[b.name] ?? 0) + 1;
  const system = events.filter((e) => e.type === 'system');
  const hookHits = {};
  for (const e of system) if (e.subtype === 'hook_started') hookHits[e.hook_name] = (hookHits[e.hook_name] ?? 0) + 1;
  return { result, tools, hookHits, systemText: system.map((e) => JSON.stringify(e)).join('\n') };
}

