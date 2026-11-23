#!/usr/bin/env node
// Aggregate bench/results/<batch>/runs.jsonl into Markdown tables. Usage: node bench/report.mjs [--batch name]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RESULTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
const argv = process.argv.slice(2);
const batch = argv[argv.indexOf('--batch') + 1] ?? readdirSync(RESULTS).sort().at(-1);
const rows = readFileSync(path.join(RESULTS, batch, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const runs = [...new Map(rows.map((r) => [r.runId, r])).values()]; // last row per runId (resumed batches)

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
const k = (n) => (Number.isNaN(n) ? '–' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const usd = (n) => (Number.isNaN(n) ? '–' : `$${n.toFixed(2)}`);
const delta = (v, base) => (Number.isNaN(v) || !base ? '–' : `${v >= base ? '+' : ''}${(((v - base) / base) * 100).toFixed(0)}%`);
const range = (xs, f) => (xs.length > 1 ? ` (${f(Math.min(...xs))}–${f(Math.max(...xs))})` : '');
const by = (xs, key) => xs.reduce((m, x) => ((m[key(x)] ??= []).push(x), m), {});
const armOrder = (a) => (a === 'baseline' ? '' : a);
const out = [];
const say = (s = '') => out.push(s);

function stats(rs) {
  const v = rs.filter((r) => r.valid);
  const passes = v.filter((r) => r.pass).length;
  const col = (f) => v.map(f);
  return {
    run: rs.length, valid: v.length, passes,
    input: median(col((r) => r.tokens.totalInput)), output: median(col((r) => r.tokens.output)), cost: median(col((r) => r.costUsd)),
    costs: col((r) => r.costUsd), turns: median(col((r) => r.turns)), tools: median(col((r) => r.toolCalls)), secs: median(col((r) => r.durationMs / 1000)),
    diff: median(col((r) => r.diff.added + r.diff.deleted)),
    perPass: passes ? v.reduce((s, r) => s + r.costUsd, 0) / passes : NaN, total: v.reduce((s, r) => s + r.costUsd, 0),
  };
}

const real = runs.filter((r) => r.scenario !== '_calibrate');
const calib = runs.filter((r) => r.scenario === '_calibrate');
say(`# Benchmark report: ${batch}`);
say(`Model ${runs[0]?.model}, effort ${runs[0]?.effort}. Medians over valid runs; cost ranges are min–max. "in" is total input tokens (fresh + cache write + cache read); "out" is output tokens; cost is list-price USD.`);

for (const [scenario, rs] of Object.entries(by(real, (r) => r.scenario))) {
  const per = Object.entries(by(rs, (r) => r.arm)).sort(([a], [b]) => armOrder(a).localeCompare(armOrder(b))).map(([arm, x]) => [arm, stats(x)]);
  const base = per.find(([a]) => a === 'baseline')?.[1];
  say(`\n## ${scenario} (${rs[0].size})\n`);
  say('| arm | valid/run | pass | in | Δin | out | Δout | cost (range) | Δcost | cost per pass | turns | tool calls | secs | diff lines |');
  say('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [arm, s] of per) say(`| ${arm} | ${s.valid}/${s.run} | ${s.passes}/${s.valid} | ${k(s.input)} | ${delta(s.input, base?.input)} | ${k(s.output)} | ${delta(s.output, base?.output)} | ${usd(s.cost)}${range(s.costs, usd)} | ${delta(s.cost, base?.cost)} | ${usd(s.perPass)} | ${k(s.turns)} | ${k(s.tools)} | ${k(s.secs)} | ${k(s.diff)} |`);
}

say('\n## Did the arms fire?\n');
say('RTK only hooks the Bash tool. If the agent runs its commands through PowerShell (default on Windows), RTK has nothing to compress. Medians per run.\n');
say('| scenario | arm | Bash calls | PowerShell calls | PreToolUse:Bash hook hits |');
say('|---|---|---|---|---|');
for (const [key, rs] of Object.entries(by(real.filter((r) => r.valid), (r) => `${r.scenario} | ${r.arm}`))) {
  say(`| ${key} | ${k(median(rs.map((r) => r.tools.Bash ?? 0)))} | ${k(median(rs.map((r) => r.tools.PowerShell ?? 0)))} | ${k(median(rs.map((r) => r.hookHits?.['PreToolUse:Bash'] ?? 0)))} |`);
}

const totals = Object.entries(by(real, (r) => r.arm)).sort(([a], [b]) => armOrder(a).localeCompare(armOrder(b)))
  .map(([arm, rs]) => [arm, rs.filter((r) => r.valid), Object.values(by(rs, (r) => r.scenario)).map((x) => stats(x))]);
const baseTotal = totals.find(([a]) => a === 'baseline');
const sumMedian = (per) => per.reduce((n, s) => n + s.cost, 0);
say('\n## All scenarios together\n');
say('Sum of per-scenario median cost, so a big task does not drown a small one by run count. Pass rate pools every valid run.\n');
say('| arm | Σ median cost | Δ vs baseline | pass rate | total spend (valid runs) |');
say('|---|---|---|---|---|');
for (const [arm, v, per] of totals) say(`| ${arm} | ${usd(sumMedian(per))} | ${delta(sumMedian(per), baseTotal && sumMedian(baseTotal[2]))} | ${v.filter((r) => r.pass).length}/${v.length} | ${usd(v.reduce((n, r) => n + r.costUsd, 0))} |`);

if (calib.length) {
  say('\n## Fixed overhead (one-turn "reply OK" probe)\n');
  say('Tokens an arm adds before any work happens. This is paid on every session regardless of task size.\n');
  say('| arm | total input tokens | Δ vs baseline | cost |');
  say('|---|---|---|---|');
  const cs = Object.entries(by(calib, (r) => r.arm)).map(([arm, x]) => [arm, stats(x)]);
  const cb = cs.find(([a]) => a === 'baseline')?.[1];
  for (const [arm, s] of cs) say(`| ${arm} | ${k(s.input)} | ${delta(s.input, cb?.input)} | ${usd(s.cost)} |`);
}

const bad = runs.filter((r) => !r.valid);
if (bad.length) {
  say('\n## Excluded (invalid) runs\n');
  for (const r of bad) say(`- ${r.runId}: ${r.invalid.join('; ')}`);
}
const small = Math.min(...Object.values(by(real, (r) => `${r.scenario}/${r.arm}`)).map((x) => x.filter((r) => r.valid).length));
if (small < 5) say(`\n> Fewest valid runs in any cell: ${small}. Below ~5, differences under roughly 20–30% are within run-to-run noise; read the cost ranges before trusting a Δ.`);

writeFileSync(path.join(RESULTS, batch, 'report.md'), `${out.join('\n')}\n`);
console.log(out.join('\n'));
