import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AtbError } from './errors.mjs';
import { createZip } from './zip.mjs';
import { sha256Buffer } from './hash.mjs';
import { atbRoot, loadStoredTask } from './storage.mjs';
import { normalizeRepoPath } from './path-safety.mjs';

// Text Result Reply: the worker pastes framed files into chat; the host computes hashes and builds the Result Capsule ZIP.
export const MAX_REPLY_BYTES = 16 * 1024 * 1024;
const RESULT_STATUSES = new Set(['complete', 'partial', 'blocked', 'research-only']);

function invalid(message) {
  return new AtbError('INVALID_RESULT_REPLY', message);
}

function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end);
}

// One wrapping Markdown fence (``` or ~~~, any length, optional language) is transport, not content.
function blockContent(rawLines) {
  let lines = trimBlankEdges(rawLines);
  const fence = lines[0]?.match(/^\s*(`{3,}|~{3,})[^`~]*$/);
  if (fence && lines.length >= 2) {
    const close = lines.at(-1).trim();
    if (close.length >= fence[1].length && [...close].every((char) => char === fence[1][0])) lines = lines.slice(1, -1);
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

function cleanPath(value, lineNumber) {
  const cleaned = value.trim().replace(/^[`'"]+|[`'"]+$/g, '');
  if (!cleaned) throw invalid(`Missing path on reply line ${lineNumber}`);
  return normalizeRepoPath(cleaned);
}

// ChatGPT's Copy button re-serialises the reply as Markdown: it escapes marker brackets (<<\<) and ends lines with a hard-break backslash.
// Only marker lines are unescaped, so file content is never altered.
function unescapeMarkerLine(line) {
  return /^\s*<<\\?<ATB_/.test(line) ? line.replace(/\\([<>_])/g, '$1').replace(/\\\s*$/, '') : line;
}

export function parseResultReply(rawText) {
  const text = rawText.split(/\r?\n/).map(unescapeMarkerLine).join('\n');
  const header = text.match(/<<<ATB_RESULT:([A-Za-z0-9_]+)>>>/);
  if (!header) throw invalid('Reply is missing the <<<ATB_RESULT:...>>> header line');
  const boundary = header[1];
  const markers = {
    file: `<<<ATB_FILE:${boundary}>>>`,
    remove: `<<<ATB_DELETE:${boundary}>>>`,
    report: `<<<ATB_REPORT:${boundary}>>>`,
    end: `<<<ATB_END:${boundary}>>>`,
  };
  const lines = text.slice(header.index + header[0].length).split(/\r?\n/);
  const result = { boundary, status: null, summary: '', files: [], deletes: [], report: null };
  const seen = new Set();
  const claim = (repoPath, lineNumber) => {
    if (seen.has(repoPath)) throw invalid(`Path appears more than once in reply: ${repoPath} (line ${lineNumber})`);
    seen.add(repoPath);
  };
  let block = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (block) {
      if (trimmed === markers.end) {
        if (block.type === 'file') result.files.push({ path: block.path, content: blockContent(block.lines) });
        else result.report = blockContent(block.lines);
        block = null;
      } else block.lines.push(line);
      continue;
    }
    if (trimmed.startsWith(markers.file)) {
      const repoPath = cleanPath(trimmed.slice(markers.file.length), i + 1);
      claim(repoPath, i + 1);
      block = { type: 'file', path: repoPath, lines: [] };
    } else if (trimmed.startsWith(markers.remove)) {
      const repoPath = cleanPath(trimmed.slice(markers.remove.length), i + 1);
      claim(repoPath, i + 1);
      result.deletes.push(repoPath);
    } else if (trimmed === markers.report) {
      if (result.report !== null) throw invalid('Reply contains more than one report block');
      block = { type: 'report', lines: [] };
    } else if (result.files.length === 0 && result.deletes.length === 0) {
      const field = trimmed.match(/^\**(status|summary)\**\s*:\s*(.*)$/i);
      if (field?.[1].toLowerCase() === 'status' && !result.status) result.status = field[2].trim().replace(/[`*\\]/g, '').toLowerCase();
      if (field?.[1].toLowerCase() === 'summary' && !result.summary) result.summary = field[2].trim().replace(/\\$/, '');
    }
  }
  if (block) throw invalid(`Reply block for ${block.path ?? 'REPORT'} is missing its ${markers.end} line; the reply may be truncated`);
  result.status ??= 'complete';
  if (!RESULT_STATUSES.has(result.status)) throw invalid(`Invalid reply status: ${result.status}`);
  return result;
}

export function taskIdFromBoundary(boundary) {
  const match = boundary.match(/^ATB_(.+)_[0-9a-f]{16}$/);
  if (!match) throw invalid(`Reply boundary does not identify a task: ${boundary}`);
  return match[1];
}

export async function packResultReply({ repoRoot, replyPath }) {
  if ((await stat(replyPath)).size > MAX_REPLY_BYTES) throw invalid(`Reply exceeds ${MAX_REPLY_BYTES} bytes`);
  const parsed = parseResultReply(await readFile(replyPath, 'utf8'));
  const taskId = taskIdFromBoundary(parsed.boundary);
  const task = await loadStoredTask(repoRoot, taskId);
  if (task.manifest.file_boundary !== parsed.boundary) throw invalid('Reply boundary does not match the stored Task Capsule');
  const embedded = new Set(task.files.map((file) => file.path));
  const entries = [];
  const files = [];
  for (const file of parsed.files) {
    const data = Buffer.from(file.content, 'utf8');
    files.push({ path: file.path, operation: embedded.has(file.path) ? 'modify' : 'create', sha256: sha256Buffer(data), size_bytes: data.length });
    entries.push({ name: `files/${file.path}`, data });
  }
  for (const repoPath of parsed.deletes) files.push({ path: repoPath, operation: 'delete' });
  const manifest = {
    atb_protocol: '1.0',
    capsule_type: 'result',
    schema_version: '1.1',
    hash_algorithm: 'sha256',
    status: parsed.status,
    ...(parsed.status === 'research-only' ? { result_type: 'research' } : {}),
    task_id: taskId,
    source_base_commit: task.manifest.project?.base_commit,
    summary: parsed.summary,
    transport: 'text-reply',
    files,
  };
  entries.unshift({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
  if (parsed.report !== null) entries.push({ name: 'REPORT.md', data: parsed.report });
  const directory = path.join(atbRoot(repoRoot), 'tasks', taskId, 'replies');
  await mkdir(directory, { recursive: true });
  const zipPath = path.join(directory, `reply-${Date.now().toString(36)}.zip`);
  await writeFile(zipPath, createZip(entries));
  return { zipPath, taskId };
}

async function isZipFile(file) {
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(4);
    const { bytesRead } = await handle.read(head, 0, 4, 0);
    return bytesRead === 4 && head.readUInt32LE(0) === 0x04034b50;
  } finally {
    await handle.close();
  }
}

// Import accepts either a Result Capsule ZIP or a saved text reply.
export async function materializeResult({ repoRoot, resultPath }) {
  if (await isZipFile(resultPath)) return { resultPath, transport: 'zip' };
  const packed = await packResultReply({ repoRoot, replyPath: resultPath });
  return { resultPath: packed.zipPath, transport: 'text-reply', replyPath: resultPath };
}
