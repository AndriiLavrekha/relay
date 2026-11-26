import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/process.mjs';
import { findGitRoot, getGitState } from '../src/repository.mjs';
import { sha256Text, sha256File } from '../src/hash.mjs';

async function makeRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-repo-'));
  await runProcess('git', ['init', '-b', 'main'], { cwd: root });
  await runProcess('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await runProcess('git', ['config', 'user.name', 'ATB Test'], { cwd: root });
  await writeFile(path.join(root, 'a.txt'), 'alpha\n');
  await runProcess('git', ['add', 'a.txt'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

test('findGitRoot resolves the repository from a nested directory', async () => {
  const root = await makeRepo();
  const nested = path.join(root, 'src', 'deep');
  await mkdir(nested, { recursive: true });
  assert.equal(await findGitRoot(nested), await realpath(root));
});

test('getGitState reports branch, head and exact dirty state', async () => {
  const root = await makeRepo();
  const clean = await getGitState(root);
  assert.equal(clean.branch, 'main');
  assert.match(clean.head, /^[0-9a-f]{40}$/);
  assert.equal(clean.dirty, false);

  await writeFile(path.join(root, 'a.txt'), 'changed\n');
  const dirty = await getGitState(root);
  assert.equal(dirty.head, clean.head);
  assert.equal(dirty.dirty, true);
  assert.match(dirty.status, /a\.txt/);
});

test('sha256 helpers are stable for text and files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-hash-'));
  const file = path.join(root, 'value.txt');
  await writeFile(file, 'abc');
  const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(sha256Text('abc'), expected);
  assert.equal(await sha256File(file), expected);
});
