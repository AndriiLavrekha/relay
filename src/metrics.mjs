import { appendFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { AtbError } from './errors.mjs';
import { loadLifecycle } from './lifecycle.mjs';
import { assertSafeStorageRoot, atbRoot, listStoredTasks, loadStoredTask } from './storage.mjs';

// Local-only usage metrics. Counts tokens in Claude Code session transcripts that were spent while the export/import/plan skills ran,
// attributes them to the task they handled, and keeps an append-only ledger so the numbers survive transcript pruning.
// No prompt or code content is stored: only ids, timestamps and token counts.

// USD per million tokens for Sonnet 5.5, fitted exactly (0% error) to 100 headless runs: cache write (1h) 4, cache read 0.10, output 10.
// Not pinned down by that data: input (about 16 tokens per run, so any price is negligible) and the 5-minute cache write (never used). Both are
// assumptions at the usual 1.25x of 2. Other models report tokens only until you add prices to .agent-task-bridge/config.json:
//   "metricsRates": { "<model>": { "input": n, "cacheWrite5m": n, "cacheWrite1h": n, "cacheRead": n, "output": n } }
export const DEFAULT_RATES = Object.freeze({ 'claude-sonnet-5-5': { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 } });

const SKILL = /^(?:[\w-]+:)?(export|import|plan)-chatgpt$/;
const TASK_ID = /"taskId"\s*:\s*"(atb_[A-Za-z0-9_.-]+)"/;
const ANY_ID = /\batb_[a-z0-9]+_[0-9a-f]{10}\b/g; // fallback when the CLI output was reshaped (piped, truncated): the last id seen in the window
const LEDGER = 'metrics.jsonl';
export const PHASES = ['plan', 'prep', 'export', 'import'];

const emptyTokens = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
const addTokens = (a, b) => { for (const k of Object.keys(a)) a[k] += b[k] ?? 0; return a; };
const sameTokens = (a, b) => Object.keys(emptyTokens()).every((k) => (a?.[k] ?? 0) === (b?.[k] ?? 0));
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => b?.text ?? '').join('\n') : '');

function isHumanPrompt(e) {
  if (e.type !== 'user' || e.isSidechain || e.isMeta) return false;
  const c = e.message?.content;
  return typeof c === 'string' || (Array.isArray(c) && c.length > 0 && !c.some((b) => b.type === 'tool_result'));
}

export function costOf(model, usage, rates = DEFAULT_RATES) {
  const key = Object.keys(rates).find((m) => model === m || model?.startsWith(`${m}-`));
  if (!key) return null;
  const r = rates[key];
  // A config entry may give only input/output; cache prices then follow Anthropic's usual multipliers of the input price.
  const w5 = r.cacheWrite5m ?? r.input * 1.25; const w1 = r.cacheWrite1h ?? r.input * 2; const rd = r.cacheRead ?? r.input * 0.1;
  return (usage.input * r.input + usage.cacheWrite5m * w5 + usage.cacheWrite1h * w1 + usage.cacheRead * rd + usage.output * r.output) / 1e6;
}

// One row per (session, skill invocation, phase). Phases: plan (plan-chatgpt), prep (export skill until the exporter runs: reading the
// repo, bounding the task, writing the delegation), export (the exporter run and the hand-off), import (import-chatgpt through integrate).
export function parseTranscript(text, rates = DEFAULT_RATES) {
  const groups = new Map(); const msgs = new Map();
  let group = null; let sessionId = null;
  for (const line of text.split('\n')) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    sessionId ??= e.sessionId ?? e.session_id ?? null;
    if (isHumanPrompt(e)) { group = null; continue; }
    if (e.type === 'user') {
      if (group && Array.isArray(e.message?.content)) for (const b of e.message.content) {
        if (b.type !== 'tool_result') continue;
        const t = textOf(b.content);
        group.taskId ??= TASK_ID.exec(t)?.[1] ?? null;
        group.seen = [...t.matchAll(ANY_ID)].at(-1)?.[0] ?? group.seen;
      }
      continue;
    }
    if (e.type !== 'assistant' || !e.message) continue;
    let after = null;
    for (const b of e.message.content ?? []) {
      if (b.type !== 'tool_use') continue;
      const skill = b.name === 'Skill' ? SKILL.exec(b.input?.skill ?? '') : null;
      const cmd = String(b.input?.command ?? '');
      if (skill) { group = { id: e.message.id ?? e.uuid, kind: skill[1], phase: skill[1] === 'export' ? 'prep' : skill[1], taskId: null }; groups.set(group.id, group); }
      else if (group?.phase === 'prep' && /agent-task-bridge/.test(cmd) && /\bexport\b/.test(cmd)) after = 'export';
    }
    const u = e.message.usage;
    const id = e.message.id ?? e.requestId ?? e.uuid;
    if (group && u && id) {
      const prev = msgs.get(id)?.usage ?? { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 };
      const cc = u.cache_creation;
      const next = {
        input: Math.max(prev.input, u.input_tokens ?? 0), cacheRead: Math.max(prev.cacheRead, u.cache_read_input_tokens ?? 0), output: Math.max(prev.output, u.output_tokens ?? 0),
        cacheWrite5m: Math.max(prev.cacheWrite5m, cc ? cc.ephemeral_5m_input_tokens ?? 0 : u.cache_creation_input_tokens ?? 0),
        cacheWrite1h: Math.max(prev.cacheWrite1h, cc?.ephemeral_1h_input_tokens ?? 0),
      };
      msgs.set(id, { group, phase: group.phase, usage: next, model: e.message.model, at: e.timestamp });
    }
    if (after) group.phase = after;
  }
  const rows = new Map();
  for (const m of msgs.values()) {
    const key = `${sessionId}|${m.group.id}|${m.phase}`;
    const row = rows.get(key) ?? { key, sessionId, taskId: null, phase: m.phase, messages: 0, tokens: emptyTokens(), costUsd: 0, costComplete: true, models: new Set(), startedAt: m.at, endedAt: m.at };
    row.messages++;
    addTokens(row.tokens, { input: m.usage.input, cacheWrite: m.usage.cacheWrite5m + m.usage.cacheWrite1h, cacheRead: m.usage.cacheRead, output: m.usage.output });
    const c = costOf(m.model, m.usage, rates);
    if (c === null) row.costComplete = false; else row.costUsd += c;
    if (m.model) row.models.add(m.model);
    if (m.at < row.startedAt) row.startedAt = m.at;
    if (m.at > row.endedAt) row.endedAt = m.at;
    row.taskId = m.group.taskId ?? (m.group.kind === 'plan' ? null : m.group.seen ?? null);
    rows.set(key, row);
  }
  return [...rows.values()].map((r) => ({ ...r, models: [...r.models] }));
}

async function readJson(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } }

export async function loadRates(repoRoot) {
  const cfg = await readJson(path.join(atbRoot(repoRoot), 'config.json'));
  return { ...DEFAULT_RATES, ...(cfg?.metricsRates ?? {}) };
}

export async function readLedger(repoRoot) {
  let text = '';
  try { text = await readFile(path.join(atbRoot(repoRoot), LEDGER), 'utf8'); } catch { return { usage: new Map(), notes: new Map() }; }
  const usage = new Map(); const notes = new Map();
  for (const line of text.split('\n')) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.kind === 'usage') usage.set(r.key, r); else if (r.kind === 'note') notes.set(r.taskId, r);
  }
  return { usage, notes };
}

async function appendLedger(repoRoot, records) {
  if (!records.length) return;
  await assertSafeStorageRoot(repoRoot);
  await mkdir(atbRoot(repoRoot), { recursive: true });
  await appendFile(path.join(atbRoot(repoRoot), LEDGER), `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
}

// Parse transcripts and append only rows that are new or changed. Never creates .agent-task-bridge/ itself: a repo that never exported has nothing to measure.
export async function collectMetrics(repoRoot, transcriptPaths) {
  if (!(await stat(atbRoot(repoRoot)).then((s) => s.isDirectory(), () => false))) return { collected: 0, scanned: 0 };
  const rates = await loadRates(repoRoot);
  const { usage } = await readLedger(repoRoot);
  const fresh = []; let scanned = 0;
  for (const file of transcriptPaths) {
    let text; try { text = await readFile(file, 'utf8'); } catch { continue; }
    if (!text.includes('-chatgpt')) continue;
    scanned++;
    for (const row of parseTranscript(text, rates)) {
      const old = usage.get(row.key);
      if (old && sameTokens(old.tokens, row.tokens) && old.taskId === row.taskId) continue;
      fresh.push({ v: 1, kind: 'usage', ...row, collectedAt: new Date().toISOString() });
    }
  }
  await appendLedger(repoRoot, fresh);
  return { collected: fresh.length, scanned };
}

export async function projectTranscripts(repoRoot) {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude'), 'projects', path.resolve(repoRoot).replace(/[^A-Za-z0-9]/g, '-'));
  try { return (await readdir(dir)).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f)); } catch { return []; }
}

export async function recordNote(repoRoot, taskId, claudeEstimateUsd) {
  if (!(claudeEstimateUsd >= 0) || !Number.isFinite(claudeEstimateUsd)) throw new AtbError('INVALID_ARGUMENT', '--claude-estimate must be a non-negative number of USD');
  await loadStoredTask(repoRoot, taskId);
  await appendLedger(repoRoot, [{ v: 1, kind: 'note', taskId, claudeEstimateUsd, at: new Date().toISOString() }]);
}

const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

export async function buildReport(repoRoot) {
  const { usage, notes } = await readLedger(repoRoot);
  const byTask = new Map();
  for (const r of usage.values()) {
    const id = r.taskId ?? (r.phase === 'plan' ? '(planning)' : '(unattributed)');
    const t = byTask.get(id) ?? { taskId: id, phases: {}, tokens: emptyTokens(), costUsd: 0, costComplete: true };
    const p = t.phases[r.phase] ?? { messages: 0, tokens: emptyTokens(), costUsd: 0, costComplete: true };
    p.messages += r.messages; addTokens(p.tokens, r.tokens); p.costUsd += r.costUsd; p.costComplete &&= r.costComplete;
    t.phases[r.phase] = p; addTokens(t.tokens, r.tokens); t.costUsd += r.costUsd; t.costComplete &&= r.costComplete;
    byTask.set(id, t);
  }
  const stored = new Map((await listStoredTasks(repoRoot)).map((t) => [t.taskId, t]));
  const tasks = [];
  for (const t of byTask.values()) {
    const meta = stored.get(t.taskId);
    const row = { ...t, title: meta?.title ?? null, createdAt: meta?.createdAt ?? null, lifecycle: null, integrated: false, imports: 0, validationPassed: null, capsuleTokens: null, waitMinutes: null, claudeEstimateUsd: notes.get(t.taskId)?.claudeEstimateUsd ?? null };
    if (meta) {
      const lc = await loadLifecycle(repoRoot, t.taskId); row.lifecycle = lc?.state ?? null;
      row.capsuleTokens = (await readJson(path.join(atbRoot(repoRoot), 'tasks', t.taskId, 'summary.json')))?.context?.estimated_tokens ?? null;
      const dir = path.join(atbRoot(repoRoot), 'tasks', t.taskId, 'imports');
      const ids = await readdir(dir).catch(() => []);
      row.imports = ids.length;
      let first = null;
      for (const id of ids) {
        const l = await loadLifecycle(repoRoot, t.taskId, id).catch(() => null);
        if (l?.state === 'integrated') row.integrated = true;
        const at = l?.events?.[0]?.at; if (at && (!first || at < first)) first = at;
        const rep = await readJson(path.join(dir, id, 'report.json'));
        if (rep?.validation && rep.validation.passed !== undefined) row.validationPassed = (row.validationPassed ?? true) && rep.validation.passed === true;
      }
      const exportedAt = lc?.events?.[0]?.at;
      if (first && exportedAt) row.waitMinutes = Math.round((Date.parse(first) - Date.parse(exportedAt)) / 60000);
    }
    row.savingPct = row.claudeEstimateUsd && row.costComplete ? Math.round((1 - row.costUsd / row.claudeEstimateUsd) * 100) : null;
    tasks.push(row);
  }
  tasks.sort((a, b) => String(a.createdAt ?? 'z').localeCompare(String(b.createdAt ?? 'z')));
  const real = tasks.filter((t) => t.createdAt);
  const integrated = real.filter((t) => t.integrated);
  const spent = real.reduce((s, t) => s + t.costUsd, 0);
  return {
    tasks,
    totals: {
      tasks: real.length, integrated: integrated.length, costUsd: spent, costComplete: real.every((t) => t.costComplete),
      medianCostUsd: median(real.map((t) => t.costUsd)), costPerIntegratedUsd: integrated.length ? spent / integrated.length : null,
      medianSavingPct: median(real.map((t) => t.savingPct).filter((p) => p !== null)),
    },
  };
}

const usd = (n, complete = true) => (complete ? `$${n.toFixed(2)}` : `>=$${n.toFixed(2)}`);
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const inTok = (t) => t.input + t.cacheWrite + t.cacheRead;

export function formatMetrics({ tasks, totals }) {
  if (!tasks.length) return 'No delegation usage recorded yet. Run an export or import with the task-bridge skills in Claude Code, then run `metrics` again.';
  const out = [];
  for (const t of tasks) {
    out.push(`${t.taskId}${t.title ? `  "${t.title}"` : ''}${t.lifecycle ? `  [${t.lifecycle}${t.integrated ? ', integrated' : ''}]` : ''}`);
    for (const ph of PHASES) {
      const p = t.phases[ph]; if (!p) continue;
      out.push(`  ${ph.padEnd(7)} ${usd(p.costUsd, p.costComplete).padStart(8)}   ${k(inTok(p.tokens)).padStart(7)} in (${k(p.tokens.cacheRead)} cached)  ${k(p.tokens.output).padStart(6)} out  ${p.messages} msgs`);
    }
    out.push(`  total   ${usd(t.costUsd, t.costComplete).padStart(8)}   ${k(inTok(t.tokens)).padStart(7)} in  ${k(t.tokens.output).padStart(6)} out`);
    const facts = [t.capsuleTokens ? `capsule ~${k(t.capsuleTokens)} tokens` : null, t.imports ? `${t.imports} import(s)` : null, t.validationPassed === null ? null : `validation ${t.validationPassed ? 'passed' : 'FAILED'}`, t.waitMinutes === null ? null : `ChatGPT wait ${t.waitMinutes} min`].filter(Boolean);
    if (facts.length) out.push(`  ${facts.join(' | ')}`);
    if (t.claudeEstimateUsd !== null) out.push(`  your Claude estimate ${usd(t.claudeEstimateUsd)}${t.savingPct === null ? '' : ` -> saving ${t.savingPct}%`}`);
    out.push('');
  }
  const s = totals;
  out.push(`${s.tasks} task(s), ${s.integrated} integrated. Claude spent on orchestration: ${usd(s.costUsd, s.costComplete)}${s.medianCostUsd === null ? '' : `, median ${usd(s.medianCostUsd, s.costComplete)} per task`}${s.costPerIntegratedUsd === null ? '' : `, ${usd(s.costPerIntegratedUsd, s.costComplete)} per integrated task`}.`);
  if (s.medianSavingPct !== null) out.push(`Median saving vs your Claude estimates: ${s.medianSavingPct}%.`);
  out.push('Cost is list price from transcript token counts (">=" marks models without a known price). ChatGPT time and cost are not included. Add what Claude would have spent with `metrics note <task-id> --claude-estimate <usd>`.');
  return out.join('\n');
}
