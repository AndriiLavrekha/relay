import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from './process.mjs';

// Three-way merge of the worker's file onto a locally changed file, using the exported baseline as the common base.
export async function mergeThreeWay({ base, current, worker }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'atb-merge-'));
  try {
    const files = { current: path.join(directory, 'current'), base: path.join(directory, 'base'), worker: path.join(directory, 'worker') };
    await Promise.all([writeFile(files.current, current), writeFile(files.base, base), writeFile(files.worker, worker)]);
    const result = await runProcess('git', ['merge-file', '-p', '-L', 'local', '-L', 'baseline', '-L', 'worker', files.current, files.base, files.worker], { allowFailure: true, cwd: directory });
    // git merge-file exits with the conflict count (capped at 127); anything else is an error.
    if (result.code < 0 || result.code > 127) return { ok: false, error: result.stderr.trim() || `git merge-file exited ${result.code}` };
    return { ok: true, conflicts: result.code, content: result.stdout };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
