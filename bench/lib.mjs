import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..');
export const RESULTS = path.join(HERE, 'results');

export function loadScenarios() {
  const dir = path.join(HERE, 'scenarios');
  return Object.fromEntries(readdirSync(dir).map((name) => {
    const s = JSON.parse(readFileSync(path.join(dir, name, 'scenario.json'), 'utf8'));
    return [s.id, { ...s, dir: path.join(dir, name) }];
  }));
}

export function sh(cmd, cwd, timeout = 600_000) {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout, maxBuffer: 1 << 28 });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

export function git(args, cwd, input) {
  const r = spawnSync('git', args, { cwd, input, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

// Fresh directory per run. Git sources come from `git archive`, so the answer commit is never reachable from the workdir.
export function materialize(scenario, spec) {
  const dest = mkdtempSync(path.join(tmpdir(), 'atb-bench-'));
  if (spec.type === 'dir') cpSync(path.join(scenario.dir, spec.path), dest, { recursive: true });
  else {
    const tar = git(['archive', '--format=tar', spec.commit], REPO);
    const r = spawnSync('tar', ['-xf', '-'], { cwd: dest, input: tar });
    if (r.status !== 0) throw new Error(`tar extract failed: ${r.stderr}`);
  }
  return dest;
}

export function buildWorkdir(scenario) {
  const work = scenario.source ? materialize(scenario, scenario.source) : mkdtempSync(path.join(tmpdir(), 'atb-bench-'));
  git(['init', '-q'], work);
  git(['add', '-A'], work);
  git(['-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'baseline'], work);
  return work;
}

export function applyHidden(scenario, work) {
  const h = scenario.hidden;
  if (!h) return;
  if (h.type === 'dir') cpSync(path.join(scenario.dir, h.path), work, { recursive: true });
  else for (const f of h.files) {
    const target = path.join(work, f);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, git(['show', `${h.commit}:${f}`], REPO));
  }
}

export function measureDiff(work) {
  git(['add', '-A'], work);
  const numstat = git(['diff', '--cached', '--numstat', 'HEAD'], work).toString().trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
  // plugins/ holds generated copies of src/, so counting them would triple every change.
  const own = numstat.filter(([, , file]) => !file.startsWith('plugins/'));
  return { files: own.length, added: own.reduce((n, [a]) => n + (Number(a) || 0), 0), deleted: own.reduce((n, [, d]) => n + (Number(d) || 0), 0), patch: git(['diff', '--cached', 'HEAD'], work).toString() };
}

