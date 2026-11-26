#!/usr/bin/env node
// ChatGPT leg of the benchmark: export the same scenarios as Task Capsules, import the worker's replies, grade them with the
// same hidden tests, and compare against the Claude arms. See bench/README.md.
//   node bench/chatgpt.mjs prepare [--scenarios a,b] [--reps N]
//   node bench/chatgpt.mjs grade <task-dir> --reply <reply.md|result.zip> [--label chatgpt-thinking]
//   node bench/chatgpt.mjs regrade --batch main           (token-free: re-grades the Claude patches with the same metrics)
//   node bench/chatgpt.mjs compare --batch main
//   node bench/chatgpt.mjs fake-reply <task-dir>           (writes the reference solution as a reply, to verify the pipeline)
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO, RESULTS, applyHidden, buildWorkdir, git, loadScenarios, materialize, sh } from './lib.mjs';

const CLI = path.join(REPO, 'bin', 'relay.mjs');
const OUT = path.join(RESULTS, 'chatgpt');
const [command = 'help', ...rest] = process.argv.slice(2);
const positional = rest.filter((a, i) => !a.startsWith('--') && !rest[i - 1]?.startsWith('--'));
const opts = Object.fromEntries(rest.flatMap((a, i) => (a.startsWith('--') ? [[a.slice(2), rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? true : rest[i + 1]]] : [])));
const scenarios = loadScenarios();
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const jsonl = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const bridge = (args) => sh(`node "${CLI}" ${args}`, REPO);

// ---- grading shared by ChatGPT replies and Claude patches -------------------------------------------------------------

// node --test prints "# pass N" (TAP) or "ℹ pass N" (spec) depending on the Node version and TTY.
function testCounts(out) {
  const n = (name) => Number(out.match(new RegExp(`(?:#|ℹ)\\s*${name}\\s+(\\d+)`))?.[1] ?? NaN);
  return { total: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped') };
}

const inScope = (file, scope) => scope.some((s) => (s.endsWith('/**') ? file.startsWith(s.slice(0, -2)) : file === s));

// Changes since the root (baseline) commit. plugins/ holds generated copies of src/, so it is neither scored nor a scope violation.
function changedFiles(work) {
  const base = git(['rev-list', '--max-parents=0', 'HEAD'], work).toString().trim().split('\n')[0];
  git(['add', '-A'], work);
  return git(['diff', '--cached', '--numstat', base], work).toString().trim().split('\n').filter(Boolean).map((l) => l.split('\t'))
    .map(([a, d, file]) => ({ file, lines: (Number(a) || 0) + (Number(d) || 0) })).filter((c) => !c.file.startsWith('plugins/'));
}

// Production-code churn: tests are excluded because the small scenario's reference solution ships none.
const prodLines = (changed) => changed.filter((c) => !c.file.startsWith('test/')).reduce((n, c) => n + c.lines, 0);

function gradeWorkdir(s, work) {
  const changed = changedFiles(work);
  const scope = s.delegation.editable_scope;
  applyHidden(s, work);
  const accept = sh(s.accept, work);
  if (s.delegation.postApply) sh(s.delegation.postApply, work);
  const regression = sh(s.regression, work);
  const a = testCounts(accept.out); const r = testCounts(regression.out);
  return {
    accept: accept.code === 0, hiddenTests: a, regress: regression.code === 0, regressionTests: r,
    pass: accept.code === 0 && regression.code === 0,
    accuracy: a.total ? a.pass / a.total : null,
    diffLines: prodLines(changed), filesChanged: changed.length,
    outOfScope: changed.filter((c) => !inScope(c.file, scope)).map((c) => c.file),
  };
}

function referenceDiff(s) {
  const work = buildWorkdir(s);
  if (s.solution.type === 'dir') cpSync(path.join(s.dir, s.solution.path), work, { recursive: true });
  else { const sol = materialize(s, s.solution); cpSync(sol, work, { recursive: true }); rmSync(sol, { recursive: true, force: true }); }
  const lines = prodLines(changedFiles(work));
  rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  return lines;
}

// ---- prepare ----------------------------------------------------------------------------------------------------------

function delegationFor(s) {
  const d = s.delegation;
  const objective = s.prompt
    .replace(/This repo is a Node\.js ESM project; read AGENTS\.md first and follow it\.\n\n/, '')
    .replace(/The plugin runtimes under plugins\/[^\n]*$/, 'The host regenerates the generated plugin runtimes under plugins/; do not edit them.');
  return {
    objective, work_unit: d.workUnit, work_type: 'code', title: d.title,
    current_work_state: 'The repository is at its baseline commit. The change described in the objective has not been started.',
    deliverables: d.deliverables, editable_scope: d.editable_scope, acceptance_criteria: d.acceptance_criteria, non_goals: d.non_goals,
    architecture_context: 'Plain Node.js ESM project using the node:test runner, two-space indentation and semicolons. Match the style of the embedded files.',
    files: d.files,
  };
}

function prepare() {
  const ids = String(opts.scenarios ?? Object.keys(scenarios)).split(',');
  const reps = Number(opts.reps ?? 1);
  const index = [];
  for (const id of ids) for (let rep = 1; rep <= reps; rep++) {
    const s = scenarios[id];
    if (!s) throw new Error(`unknown scenario ${id}`);
    const dir = path.join(OUT, `${id}__r${rep}`);
    if (existsSync(dir)) { console.log(`skip ${path.basename(dir)} (exists; delete it to re-prepare)`); continue; }
    mkdirSync(dir, { recursive: true });
    const tmp = buildWorkdir(s);
    cpSync(tmp, path.join(dir, 'repo'), { recursive: true });
    rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
    writeFileSync(path.join(dir, 'delegation.json'), JSON.stringify(delegationFor(s), null, 2));
    const r = bridge(`export --delegation "${path.join(dir, 'delegation.json')}" --repo "${path.join(dir, 'repo')}" --source-agent bench --json`);
    if (r.code !== 0) throw new Error(`export failed for ${id}:\n${r.out}`);
    writeFileSync(path.join(dir, 'export-output.json'), r.out);
    const tasks = path.join(dir, 'repo', '.relay', 'tasks');
    const taskId = readdirSync(tasks)[0];
    for (const f of ['task.md', 'kickoff.md']) cpSync(path.join(tasks, taskId, f), path.join(dir, f));
    const bytes = statSync(path.join(dir, 'task.md')).size;
    writeFileSync(path.join(dir, 'INSTRUCTIONS.md'), [
      `# ${id} (rep ${rep}): ChatGPT delegation`, '',
      '1. Open a NEW ChatGPT conversation. Pick the model/mode you want to evaluate and note it down.',
      '2. Upload `task.md` from this folder.',
      '3. Paste the full contents of `kickoff.md` as your message and send.',
      '4. Plus with code execution: download the ZIP ChatGPT produces and save it as `result.zip` here.',
      '   Otherwise: use ChatGPT\'s Copy button on the reply and save it as `reply.md` here (UTF-8).',
      '5. Do not edit or "fix" the reply. Measure it as returned.',
      '6. Grade: `node bench/chatgpt.mjs grade "' + dir + '" --reply <path to reply.md or result.zip> --label <model/mode>`',
      '', `Capsule size: ${bytes} bytes (about ${Math.round(bytes / 4)} tokens).`, ''].join('\n'));
    index.push({ id, rep, dir, taskId, bytes });
    console.log(`prepared ${path.basename(dir)}  task ${taskId}  capsule ${bytes} bytes`);
  }
  if (index.length) writeStartHere();
}

function writeStartHere() {
  const dirs = readdirSync(OUT).filter((d) => existsSync(path.join(OUT, d, 'task.md'))).sort();
  const lines = ['# ChatGPT delegation: start here', '',
    'For each folder below: new ChatGPT conversation, upload `task.md`, paste `kickoff.md`, save the reply (`reply.md` via the Copy button, or `result.zip`), then run the grade command. Use the same ChatGPT model/mode for all folders of one label, and change `--label` when you change model/mode. Do not edit replies.', ''];
  for (const d of dirs) {
    const s = scenarios[d.split('__')[0]];
    lines.push(`## ${d}`, `Size: ${s.size}. Capsule: ${Math.round(statSync(path.join(OUT, d, 'task.md')).size / 1024)} KB.`, '', '**Task (objective as given to ChatGPT):**', '',
      ...delegationFor(s).objective.split('\n').map((l) => `> ${l}`), '',
      '**Acceptance criteria:**', ...s.delegation.acceptance_criteria.map((c) => `- ${c}`), '', `**Editable scope:** ${s.delegation.editable_scope.join(', ')}`, '',
      '```', `node bench/chatgpt.mjs grade "${path.join(OUT, d)}" --reply <reply.md or result.zip> --label <model/mode>`, '```', '');
  }
  writeFileSync(path.join(OUT, 'START-HERE.md'), lines.join('\n'));
  console.log(`\nWrote ${path.join(OUT, 'START-HERE.md')}: upload task.md and paste kickoff.md from each folder.`);
}

// ---- fake-reply -------------------------------------------------------------------------------------------------------

function fakeReply(dir) {
  const s = scenarios[path.basename(dir).split('__')[0]];
  const repo = path.join(dir, 'repo');
  const boundary = readFileSync(path.join(dir, 'task.md'), 'utf8').match(/"file_boundary": "([^"]+)"/)[1];
  const sol = s.solution.type === 'dir' ? path.join(s.dir, s.solution.path) : materialize(s, s.solution);
  const files = s.delegation.editable_scope.filter((f) => !f.endsWith('/**'));
  const blocks = [];
  for (const f of files) {
    let content = existsSync(path.join(sol, f)) ? readFileSync(path.join(sol, f), 'utf8') : null;
    if (s.hidden?.type === 'dir' && existsSync(path.join(s.dir, s.hidden.path, f))) content = readFileSync(path.join(s.dir, s.hidden.path, f), 'utf8');
    if (s.hidden?.type === 'git' && s.hidden.files.includes(f)) content = git(['show', `${s.hidden.commit}:${f}`], REPO).toString();
    if (content !== null && content !== (existsSync(path.join(repo, f)) ? readFileSync(path.join(repo, f), 'utf8') : null)) blocks.push(`<<<ATB_FILE:${boundary}>>> ${f}\n\`\`\`\n${content.replace(/\n$/, '')}\n\`\`\`\n<<<ATB_END:${boundary}>>>`);
  }
  if (s.solution.type === 'git') rmSync(sol, { recursive: true, force: true, maxRetries: 3 });
  const reply = `<<<ATB_RESULT:${boundary}>>>\nstatus: complete\nsummary: Reference solution (pipeline check, not a ChatGPT result).\n\n${blocks.join('\n\n')}\n`;
  const out = path.join(dir, 'fake-reply.md');
  writeFileSync(out, reply);
  console.log(out);
}

// ---- grade (ChatGPT replies) ------------------------------------------------------------------------------------------

function grade() {
  const dir = path.resolve(positional[0]);
  const id = path.basename(dir).split('__')[0];
  const s = scenarios[id];
  const repo = path.join(dir, 'repo');
  if (!s || !existsSync(repo)) throw new Error(`not a prepared task dir: ${dir}`);
  if (!opts.reply || opts.reply === true) throw new Error('pass --reply <reply.md|result.zip>');
  const reply = path.resolve(String(opts.reply));
  const capsuleBytes = statSync(path.join(dir, 'task.md')).size;
  const record = {
    runId: path.basename(dir), scenario: id, size: s.size, worker: String(opts.label ?? 'chatgpt'), ts: new Date().toISOString(),
    replyBytes: statSync(reply).size, capsuleBytes, tokensIn: Math.round(capsuleBytes / 4), tokensOut: Math.round(statSync(reply).size / 4),
  };
  const fail = (why) => ({ ...record, protocolOk: false, importError: why.slice(0, 400), pass: false, accept: false, regress: false, accuracy: 0, diffLines: 0, filesChanged: 0, outOfScope: [] });
  let result;
  const imp = bridge(`import "${reply}" --repo "${repo}" --json --validation-policy skip`);
  let parsed = null;
  try { parsed = JSON.parse(imp.out); } catch { /* handled below */ }
  if (!parsed?.importId || parsed.error) result = fail(`import failed: ${parsed?.error?.message ?? parsed?.error ?? imp.out}`);
  else {
    const branch = `bench-result-${Date.now().toString(36)}`;
    const integ = bridge(`integrate ${parsed.importId} --mode branch --branch ${branch} --confirm --repo "${repo}"`);
    if (integ.code !== 0) result = fail(`integrate failed: ${integ.out}`);
    else {
      // Grade a clean clone of the result branch: the repo's .relay/ holds candidate copies of test files that node --test would pick up.
      const work = path.join(dir, 'graded');
      rmSync(work, { recursive: true, force: true, maxRetries: 3 });
      git(['clone', '-q', '--branch', branch, '--single-branch', repo, work]);
      const g = gradeWorkdir(s, work);
      const base = git(['rev-list', '--max-parents=0', 'HEAD'], work).toString().trim().split('\n')[0];
      writeFileSync(path.join(dir, 'result.patch'), git(['diff', base, 'HEAD'], work));
      rmSync(work, { recursive: true, force: true, maxRetries: 3 });
      result = { ...record, protocolOk: true, resultStatus: parsed.resultStatus, stagedFiles: parsed.stagedFiles?.length ?? 0, withheld: parsed.excludedPaths?.length ?? 0, conflicts: parsed.conflicts?.length ?? 0, ...g };
    }
  }
  appendFileSync(path.join(OUT, 'grades.jsonl'), `${JSON.stringify(result)}\n`);
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.runId} [${result.worker}] hidden tests ${result.hiddenTests?.pass ?? 0}/${result.hiddenTests?.total ?? '?'}, regression ${result.regress ? 'ok' : 'FAILED'}, out-of-scope files: ${result.outOfScope.length}, diff ${result.diffLines} lines${result.importError ? `\n  ${result.importError}` : ''}`);
}

// ---- regrade (Claude patches, no tokens) ------------------------------------------------------------------------------

const latestBatch = () => readdirSync(RESULTS).filter((d) => d !== 'chatgpt').sort().at(-1);

function regrade() {
  const batchDir = path.join(RESULTS, String(opts.batch ?? latestBatch()));
  const file = path.join(batchDir, 'grades.jsonl');
  const done = new Set(jsonl(file).map((g) => g.runId));
  for (const r of jsonl(path.join(batchDir, 'runs.jsonl')).filter((x) => x.valid && x.scenario !== '_calibrate' && !done.has(x.runId))) {
    const s = scenarios[r.scenario];
    const work = buildWorkdir(s);
    const patchFile = path.join(batchDir, 'diffs', `${r.runId}.patch`);
    if (existsSync(patchFile) && statSync(patchFile).size) git(['apply', '--whitespace=nowarn', '-'], work, readFileSync(patchFile));
    const g = gradeWorkdir(s, work);
    rmSync(work, { recursive: true, force: true, maxRetries: 3 });
    appendFileSync(file, `${JSON.stringify({ runId: r.runId, scenario: r.scenario, worker: r.arm, ...g })}\n`);
    console.log(`${g.pass ? 'PASS' : 'FAIL'} ${r.runId} hidden ${g.hiddenTests.pass}/${g.hiddenTests.total}, out-of-scope ${g.outOfScope.length}`);
  }
}

// ---- compare ----------------------------------------------------------------------------------------------------------

const median = (xs) => { const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); const m = v.length >> 1; return v.length ? (v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) : NaN; };
const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '–');
const pct = (n) => (Number.isFinite(n) ? `${(n * 100).toFixed(0)}%` : '–');
const kfmt = (n) => (!Number.isFinite(n) ? '–' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

function compare() {
  const batch = String(opts.batch ?? latestBatch());
  const runs = jsonl(path.join(RESULTS, batch, 'runs.jsonl')).filter((r) => r.valid);
  const claudeGrades = jsonl(path.join(RESULTS, batch, 'grades.jsonl'));
  const gptGrades = jsonl(path.join(OUT, 'grades.jsonl'));
  const out = [`# Claude arms vs ChatGPT delegation (batch ${batch})`, '',
    'Correctness = hidden tests AND full suite pass. Accuracy = share of hidden tests that pass (finer than pass/fail). Scope precision = share of changed files inside the delegated editable scope. Diff vs reference = production-code (non-test) changed lines relative to the real commit; above 1x means more churn than needed. Token columns for Claude arms are the agent run; for ChatGPT they are capsule size in / reply size out (bytes/4), not billed tokens.', ''];
  for (const s of Object.values(scenarios)) {
    const ref = referenceDiff(s);
    const rows = [];
    for (const arm of [...new Set(claudeGrades.filter((g) => g.scenario === s.id).map((g) => g.worker))]) {
      const gs = claudeGrades.filter((g) => g.scenario === s.id && g.worker === arm);
      const rs = runs.filter((r) => r.scenario === s.id && r.arm === arm);
      rows.push({ who: `claude/${arm}`, gs, tokens: `${kfmt(median(rs.map((r) => r.tokens.totalInput)))} in / ${kfmt(median(rs.map((r) => r.tokens.output)))} out`, cost: `$${fmt(median(rs.map((r) => r.costUsd)), 2)}` });
    }
    for (const w of [...new Set(gptGrades.filter((g) => g.scenario === s.id).map((g) => g.worker))]) {
      const gs = gptGrades.filter((g) => g.scenario === s.id && g.worker === w);
      rows.push({ who: w, gs, tokens: `${kfmt(median(gs.map((g) => g.tokensIn)))} in / ${kfmt(median(gs.map((g) => g.tokensOut)))} out (est.)`, cost: 'subscription' });
    }
    out.push(`## ${s.id} (${s.size}); reference diff ${ref} lines`, '', '| worker | n | correct | accuracy | scope precision | diff vs reference | tokens | cost | import ok |', '|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      const g = r.gs;
      const prec = g.map((x) => (x.filesChanged ? 1 - x.outOfScope.length / x.filesChanged : 1));
      out.push(`| ${r.who} | ${g.length} | ${g.filter((x) => x.pass).length}/${g.length} | ${pct(median(g.map((x) => x.accuracy)))} | ${pct(median(prec))} | ${fmt(median(g.map((x) => x.diffLines)) / ref, 1)}x | ${r.tokens} | ${r.cost} | ${g.filter((x) => x.protocolOk !== false).length}/${g.length} |`);
    }
    out.push('');
  }
  const text = out.join('\n');
  writeFileSync(path.join(RESULTS, batch, 'compare.md'), text);
  console.log(text);
}

if (command === 'prepare') prepare();
else if (command === 'fake-reply') fakeReply(path.resolve(positional[0]));
else if (command === 'grade') grade();
else if (command === 'regrade') regrade();
else if (command === 'compare') compare();
else console.log('commands: prepare | grade <dir> --reply f [--label x] | regrade | compare | fake-reply <dir> (see header of bench/chatgpt.mjs)');
