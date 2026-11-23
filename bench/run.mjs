#!/usr/bin/env node
// A/B benchmark runner for coding-agent tooling (RTK, Caveman, Ponytail, ...). See bench/README.md.
//   node bench/run.mjs selftest
//   node bench/run.mjs run --scenarios small-duration,big-reply-unescape --arms baseline,rtk --reps 3 [--batch name] [--dry]
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { arms, buildSettings, parseStream, spawnClaude } from './agent.mjs';
import { HERE, REPO, RESULTS, applyHidden, buildWorkdir, git, loadScenarios, materialize, measureDiff, sh } from './lib.mjs';
const CALIBRATE = { id: '_calibrate', size: 'fixed overhead', prompt: 'Reply with exactly: OK', budgetUsd: 1 };

const [command = 'help', ...rest] = process.argv.slice(2);
const opts = Object.fromEntries(rest.flatMap((a, i) => (a.startsWith('--') ? [[a.slice(2), rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? true : rest[i + 1]]] : [])));
const model = opts.model ?? 'claude-sonnet-5-5';
const effort = opts.effort ?? 'high';

function runAgent(scenario, work, settingsFile) {
  return spawnClaude({ cwd: work, prompt: scenario.prompt, settingsFile, model, effort, budgetUsd: opts.budget ?? scenario.budgetUsd ?? 5 });
}

function executeRun(scenario, armName, rep, batchDir) {
  const runId = `${scenario.id}__${armName}__r${rep}`;
  const work = buildWorkdir(scenario);
  const settingsDir = mkdtempSync(path.join(tmpdir(), 'atb-bench-settings-'));
  const settingsFile = path.join(settingsDir, 'settings.json');
  writeFileSync(settingsFile, JSON.stringify(buildSettings(armName)));
  const run = runAgent(scenario, work, settingsFile);
  mkdirSync(path.join(batchDir, 'logs'), { recursive: true });
  writeFileSync(path.join(batchDir, 'logs', `${runId}.jsonl`), run.raw);
  const { result, tools, hookHits, systemText } = parseStream(run.raw);
  const arm = arms[armName];
  const invalid = [];
  if (!result) invalid.push(`no result event (exit ${run.status}): ${run.stderr.slice(0, 200)}`);
  if (result?.is_error && !/max_budget|max_turns/.test(result.subtype ?? '')) invalid.push(`agent error: ${result.subtype}`);
  if (result?.permission_denials?.length) invalid.push(`${result.permission_denials.length} permission denials`);
  const models = Object.keys(result?.modelUsage ?? {});
  if (models.some((m) => m !== model)) invalid.push(`model drift: ${models.join(',')}`);
  for (const s of arm.expect ?? []) if (!systemText.includes(s)) invalid.push(`arm did not fire: no "${s}" in system events`);
  for (const s of arm.forbid ?? []) if (systemText.includes(s)) invalid.push(`contaminated: "${s}" in system events`);

  const diff = scenario.source ? measureDiff(work) : { files: 0, added: 0, deleted: 0, patch: '' };
  if (diff.patch) { mkdirSync(path.join(batchDir, 'diffs'), { recursive: true }); writeFileSync(path.join(batchDir, 'diffs', `${runId}.patch`), diff.patch); }
  let accept = null; let regress = null;
  if (scenario.accept) {
    applyHidden(scenario, work);
    accept = sh(scenario.accept, work).code === 0;
    regress = scenario.regression ? sh(scenario.regression, work).code === 0 : null;
  }
  const u = result?.usage ?? {};
  const input = u.input_tokens ?? 0; const write = u.cache_creation_input_tokens ?? 0; const read = u.cache_read_input_tokens ?? 0;
  const record = {
    runId, scenario: scenario.id, size: scenario.size, arm: armName, rep, model, effort, ts: new Date().toISOString(),
    valid: invalid.length === 0, invalid,
    accept, regress, pass: scenario.accept ? accept && regress !== false : !result?.is_error,
    tokens: { input, cacheWrite: write, cacheRead: read, output: u.output_tokens ?? 0, totalInput: input + write + read },
    costUsd: result?.total_cost_usd ?? 0, turns: result?.num_turns ?? 0, durationMs: result?.duration_ms ?? run.wallMs,
    tools, hookHits, toolCalls: Object.values(tools).reduce((a, b) => a + b, 0),
    diff: { files: diff.files, added: diff.added, deleted: diff.deleted }, terminal: result?.terminal_reason ?? null, subtype: result?.subtype ?? null,
  };
  appendFileSync(path.join(batchDir, 'runs.jsonl'), `${JSON.stringify(record)}\n`);
  for (const d of [work, settingsDir]) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
  return record;
}

function selftest(scenarios) {
  let bad = 0;
  for (const s of Object.values(scenarios)) {
    const before = buildWorkdir(s); applyHidden(s, before);
    const accepted = sh(s.accept, before).code;
    const solved = s.solution.type === 'git' ? materialize(s, s.solution) : (() => { const w = buildWorkdir(s); cpSync(path.join(s.dir, s.solution.path), w, { recursive: true }); return w; })();
    applyHidden(s, solved);
    const fixedAccept = sh(s.accept, solved).code;
    const fixedRegress = s.regression ? sh(s.regression, solved).code : 0;
    const ok = accepted !== 0 && fixedAccept === 0 && fixedRegress === 0;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${s.id}: hidden tests fail before=${accepted !== 0}, pass with reference solution=${fixedAccept === 0}, regression with solution=${fixedRegress === 0}`);
    for (const d of [before, solved]) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
  }
  process.exit(bad ? 1 : 0);
}

const scenarios = { ...loadScenarios(), [CALIBRATE.id]: CALIBRATE };
if (command === 'selftest') { delete scenarios[CALIBRATE.id]; selftest(scenarios); }
else if (command === 'run') {
  const names = String(opts.scenarios ?? '').split(',').filter(Boolean);
  const armNames = String(opts.arms ?? Object.keys(arms).join(',')).split(',');
  const reps = Number(opts.reps ?? 1);
  for (const n of names) if (!scenarios[n]) throw new Error(`unknown scenario ${n}; have ${Object.keys(scenarios)}`);
  for (const a of armNames) if (!arms[a]) throw new Error(`unknown arm ${a}; have ${Object.keys(arms)}`);
  if (!names.length) throw new Error('pass --scenarios a,b (use _calibrate for the fixed-overhead probe)');
  const batch = opts.batch && opts.batch !== true ? opts.batch : new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const batchDir = path.join(RESULTS, batch);
  const done = new Set(existsSync(path.join(batchDir, 'runs.jsonl')) ? readFileSync(path.join(batchDir, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.valid).map((r) => r.runId) : []);
  // Arms interleave: rep is the outer loop and the arm order rotates, so no arm always runs first (prompt-cache warmth) or last.
  const plan = [];
  for (let rep = 1; rep <= reps; rep++) names.forEach((n, si) => armNames.forEach((_, ai) => { const a = armNames[(ai + rep - 1 + si) % armNames.length]; if (!done.has(`${n}__${a}__r${rep}`)) plan.push([n, a, rep]); }));
  const ceiling = plan.reduce((sum, [n]) => sum + Number(opts.budget ?? scenarios[n].budgetUsd ?? 5), 0);
  console.log(`batch ${batch}: ${plan.length} runs, model ${model}, effort ${effort}, hard cost ceiling $${ceiling.toFixed(2)} (list price; real spend is usually far lower)`);
  if (opts.dry) process.exit(0);
  plan.forEach(([n, a, rep], i) => {
    const r = executeRun(scenarios[n], a, rep, batchDir);
    const t = r.tokens;
    console.log(`[${i + 1}/${plan.length}] ${n}/${a} r${rep} ${r.valid ? (r.pass ? 'PASS' : 'FAIL') : 'INVALID'} $${r.costUsd.toFixed(3)} in=${t.totalInput} out=${t.output} turns=${r.turns} ${(r.durationMs / 1000).toFixed(0)}s${r.valid ? '' : ` :: ${r.invalid.join('; ')}`}`);
  });
  console.log(`done. node bench/report.mjs --batch ${batch}`);
} else console.log('usage: node bench/run.mjs selftest | run --scenarios a,b --arms x,y --reps N [--batch name] [--model m] [--effort e] [--budget usd] [--dry]');
