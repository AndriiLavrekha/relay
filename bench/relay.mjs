#!/usr/bin/env node
// Measures the Claude-side cost of delegating to ChatGPT with the real Relay plugin skills.
//   node bench/relay.mjs run --scenarios small-duration,big-reply-unescape,big-fingerprint-tsconfig --reps 3 --batch relay [--dry]
//   node bench/relay.mjs report --batch relay        # writes bench/results/relay/relay-report.md
// export stage: Claude reads the task + repo and runs the export-chatgpt skill (capsule produced, nothing implemented).
// import stage: Claude runs the import-chatgpt skill on a saved ChatGPT reply from `chatgpt.mjs prepare`, in a pristine copy of that task's repo.
// report: savings vs the Claude baseline arm of the `main` batch, with ChatGPT failures priced as a full Claude redo (conservative).
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildSettings, parseStream, spawnClaude } from './agent.mjs';
import { RESULTS, buildWorkdir, git, loadScenarios } from './lib.mjs';

const [command = 'help', ...rest] = process.argv.slice(2);
const opts = Object.fromEntries(rest.flatMap((a, i) => (a.startsWith('--') ? [[a.slice(2), rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? true : rest[i + 1]]] : [])));
const model = opts.model ?? 'claude-sonnet-5-5';
const effort = opts.effort ?? 'high';
const GPT = path.join(RESULTS, 'chatgpt');
const scenarios = loadScenarios();
const jsonl = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
const taskIdOf = (dir) => readFileSync(path.join(dir, 'task.md'), 'utf8').match(/"task_id": *"(atb_[^"]+)"/)[1];

// The user may have saved replies into the wrong folders; the zip name carries the task id, so pair by id.
function replyFor(dir) {
  const id = taskIdOf(dir);
  for (const d of readdirSync(GPT)) {
    const f = path.join(GPT, d, `atb-result-${id}.zip`);
    if (existsSync(f)) return f;
  }
  throw new Error(`no reply zip for ${id}`);
}

// Copy of a prepared task repo with grading side effects removed: back to the state right after export.
function pristineRepo(dir) {
  const work = mkdtempSync(path.join(tmpdir(), 'atb-relay-'));
  cpSync(path.join(dir, 'repo'), work, { recursive: true });
  rmSync(path.join(work, '.git', 'worktrees'), { recursive: true, force: true });
  const tasks = path.join(work, '.relay', 'tasks');
  for (const t of readdirSync(tasks)) rmSync(path.join(tasks, t, 'imports'), { recursive: true, force: true });
  rmSync(path.join(work, '.relay', 'staging-ownership'), { recursive: true, force: true });
  git(['worktree', 'prune'], work);
  for (const b of git(['branch', '--format=%(refname:short)'], work).toString().split('\n').filter((x) => x && x !== 'master' && x !== 'main')) git(['branch', '-D', b], work);
  return work;
}

const PROMPTS = {
  export: (s) => `Delegate the task below to ChatGPT with the export-chatgpt skill of the relay plugin. Do not implement it yourself. Stop after the Task Capsule is exported and tell me where it is. This is a public repository with no secrets: if the exporter's privacy gate reports only low-confidence warnings (entropy-candidate, absolute-path), I confirm them, so re-run with --confirm-privacy.\n\nTask:\n${s.prompt}`,
  import: (zip) => `A ChatGPT result for a delegated task is saved at ${zip}. Use the import-chatgpt skill of the relay plugin to import and review it. Host-owned steps are yours to run locally; for this repo that includes rebuilding the generated plugins/ with npm run bundle:plugins, so a stale plugins/ in staging is not a defect. Integrate into a new branch named chatgpt-result when staged validation passes and every changed file is inside the delegated scope, even if the worker lists known limitations; mention the limitations in your report. Otherwise do not integrate and say why in one sentence.`,
};

function execute(stage, s, rep, batchDir) {
  const runId = `${s.id}__${stage}__r${rep}`;
  const dir = path.join(GPT, `${s.id}__r${rep}`);
  const zip = stage === 'import' ? replyFor(dir) : null;
  const work = stage === 'export' ? buildWorkdir(s) : pristineRepo(dir);
  const settingsDir = mkdtempSync(path.join(tmpdir(), 'atb-relay-settings-'));
  const settingsFile = path.join(settingsDir, 'settings.json');
  writeFileSync(settingsFile, JSON.stringify(buildSettings('relay')));
  const run = spawnClaude({ cwd: work, prompt: stage === 'export' ? PROMPTS.export(s) : PROMPTS.import(zip), settingsFile, model, effort, budgetUsd: opts.budget ?? 2 });
  mkdirSync(path.join(batchDir, 'logs'), { recursive: true });
  writeFileSync(path.join(batchDir, 'logs', `${runId}.jsonl`), run.raw);
  const { result, tools, systemText } = parseStream(run.raw);
  const invalid = [];
  if (!result) invalid.push(`no result event (exit ${run.status}): ${run.stderr.slice(0, 200)}`);
  if (result?.is_error && !/max_budget|max_turns/.test(result.subtype ?? '')) invalid.push(`agent error: ${result.subtype}`);
  if (result?.permission_denials?.length) invalid.push(`${result.permission_denials.length} permission denials`);
  const models = Object.keys(result?.modelUsage ?? {});
  if (models.some((m) => m !== model)) invalid.push(`model drift: ${models.join(',')}`);
  if (/PONYTAIL MODE|Build simplest complete system/.test(systemText)) invalid.push('contaminated by another arm');
  const bridgeRoot = path.join(work, '.relay', 'tasks');
  const taskDirs = existsSync(bridgeRoot) ? readdirSync(bridgeRoot) : [];
  const checks = {};
  if (stage === 'export') {
    const made = taskDirs.map((t) => path.join(bridgeRoot, t, 'task.md')).filter(existsSync);
    checks.capsuleBytes = made.length ? statSync(made[0]).size : 0;
    if (!made.length) invalid.push('no Task Capsule was exported');
  } else {
    const imported = taskDirs.some((t) => existsSync(path.join(bridgeRoot, t, 'imports')) && readdirSync(path.join(bridgeRoot, t, 'imports')).length);
    checks.integrated = git(['branch', '--list', 'chatgpt-result'], work).toString().trim() !== '';
    if (!imported) invalid.push('the reply was never imported');
  }
  const u = result?.usage ?? {};
  const input = u.input_tokens ?? 0; const write = u.cache_creation_input_tokens ?? 0; const read = u.cache_read_input_tokens ?? 0;
  const record = {
    runId, scenario: s.id, stage, rep, model, effort, ts: new Date().toISOString(), valid: invalid.length === 0, invalid, ...checks,
    tokens: { input, cacheWrite: write, cacheRead: read, output: u.output_tokens ?? 0, totalInput: input + write + read },
    costUsd: result?.total_cost_usd ?? 0, turns: result?.num_turns ?? 0, durationMs: result?.duration_ms ?? run.wallMs, tools,
  };
  appendFileSync(path.join(batchDir, 'relay.jsonl'), `${JSON.stringify(record)}\n`);
  for (const d of [work, settingsDir]) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
  return record;
}

const pct = (a, b) => (Number.isFinite(a) && b ? `${Math.round((1 - a / b) * 100)}%` : '–');
const usd = (n) => `$${n.toFixed(2)}`;
const kfmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

function report(batch) {
  const rows = [...new Map(jsonl(path.join(RESULTS, batch, 'relay.jsonl')).map((r) => [r.runId, r])).values()].filter((r) => r.valid);
  const base = jsonl(path.join(RESULTS, opts.baseline ?? 'main', 'runs.jsonl')).filter((r) => r.valid && r.arm === 'baseline' && r.scenario !== '_calibrate');
  const grades = jsonl(path.join(GPT, 'grades.jsonl'));
  const out = [`# Relay savings (batch ${batch}) vs Claude baseline`, '',
    'Orchestration = Claude session that exports the capsule + Claude session that imports and integrates the ChatGPT reply (real Relay skills, same model and effort as the baseline). ChatGPT runs on the subscription and is not billed here. Costs are list price. "Redo" prices every failed ChatGPT result as a full Claude baseline run on top (conservative: a targeted fix would be cheaper).', ''];
  const total = { b: 0, o: 0, r: 0 };
  for (const s of Object.values(scenarios)) {
    const ex = rows.filter((r) => r.scenario === s.id && r.stage === 'export'); const im = rows.filter((r) => r.scenario === s.id && r.stage === 'import');
    const reps = ex.map((e) => e.rep).filter((rep) => im.some((i) => i.rep === rep));
    const b = base.filter((r) => r.scenario === s.id);
    if (!reps.length || !b.length) continue;
    const orch = (f) => reps.map((rep) => f(ex.find((e) => e.rep === rep)) + f(im.find((i) => i.rep === rep)));
    const B = { cost: median(b.map((r) => r.costUsd)), inp: median(b.map((r) => r.tokens.totalInput)), out: median(b.map((r) => r.tokens.output)) };
    const O = { cost: median(orch((r) => r.costUsd)), inp: median(orch((r) => r.tokens.totalInput)), out: median(orch((r) => r.tokens.output)) };
    const g = grades.filter((x) => x.scenario === s.id);
    const fail = g.length ? g.filter((x) => !x.pass).length / g.length : 0;
    const redo = O.cost + fail * B.cost;
    total.b += B.cost; total.o += O.cost; total.r += redo;
    const caught = im.filter((r) => { const gr = g.find((x) => x.runId === `${s.id}__r${r.rep}`); return gr && !gr.pass; });
    out.push(`## ${s.id} (${s.size})`, '',
      '| | Claude does it (baseline) | Claude orchestrates, ChatGPT executes | saving |', '|---|---|---|---|',
      `| cost | ${usd(B.cost)} | ${usd(O.cost)} (export ${usd(median(ex.map((r) => r.costUsd)))} + import ${usd(median(im.map((r) => r.costUsd)))}) | **${pct(O.cost, B.cost)}** |`,
      `| total input tokens | ${kfmt(B.inp)} | ${kfmt(O.inp)} | ${pct(O.inp, B.inp)} |`,
      `| output tokens | ${kfmt(B.out)} | ${kfmt(O.out)} | ${pct(O.out, B.out)} |`,
      `| cost incl. ${Math.round(fail * 100)}% ChatGPT failures redone by Claude | ${usd(B.cost)} | ${usd(redo)} | **${pct(redo, B.cost)}** |`, '',
      `n = ${reps.length} delegations, baseline n = ${b.length}. ChatGPT correct ${g.filter((x) => x.pass).length}/${g.length}. Failed replies integrated without a flag: ${caught.filter((r) => r.integrated).length}/${caught.length}. Capsule ${kfmt((median(ex.map((r) => r.capsuleBytes)) || 0) / 4)} tokens.`, '');
  }
  out.push('## All three scenarios', '', `Σ median cost: Claude does it ${usd(total.b)}; delegated ${usd(total.o)} (**${pct(total.o, total.b)} saving** when ChatGPT succeeds); with failures redone ${usd(total.r)} (**${pct(total.r, total.b)}**).`, '');
  writeFileSync(path.join(RESULTS, batch, 'relay-report.md'), out.join('\n'));
  console.log(out.join('\n'));
}

if (command === 'run') {
  const names = String(opts.scenarios ?? '').split(',').filter(Boolean);
  for (const n of names) if (!scenarios[n]) throw new Error(`unknown scenario ${n}`);
  const reps = Number(opts.reps ?? 3);
  const batch = opts.batch && opts.batch !== true ? opts.batch : 'relay';
  const batchDir = path.join(RESULTS, batch);
  const done = new Set(jsonl(path.join(batchDir, 'relay.jsonl')).filter((r) => r.valid).map((r) => r.runId));
  const plan = [];
  for (let rep = 1; rep <= reps; rep++) for (const n of names) for (const stage of String(opts.stages ?? 'export,import').split(',')) if (!done.has(`${n}__${stage}__r${rep}`)) plan.push([n, stage, rep]);
  console.log(`batch ${batch}: ${plan.length} sessions, model ${model}, effort ${effort}, hard cost ceiling $${(plan.length * Number(opts.budget ?? 2)).toFixed(2)}`);
  if (opts.dry) process.exit(0);
  plan.forEach(([n, stage, rep], i) => {
    const r = execute(stage, scenarios[n], rep, batchDir);
    console.log(`[${i + 1}/${plan.length}] ${n}/${stage} r${rep} ${r.valid ? 'ok' : 'INVALID'} $${r.costUsd.toFixed(3)} in=${r.tokens.totalInput} out=${r.tokens.output} turns=${r.turns} ${(r.durationMs / 1000).toFixed(0)}s${stage === 'import' ? ` integrated=${r.integrated}` : ''}${r.valid ? '' : ` :: ${r.invalid.join('; ')}`}`);
  });
  console.log(`done. node bench/relay.mjs report --batch ${batch}`);
} else if (command === 'report') report(opts.batch && opts.batch !== true ? opts.batch : 'relay');
else console.log('usage: node bench/relay.mjs run --scenarios a,b --reps N [--batch name] [--budget usd] [--dry] | report --batch name');
