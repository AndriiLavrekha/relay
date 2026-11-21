import { spawn } from 'node:child_process';
import { AtbError } from './errors.mjs';

function interrupted(error) {
  return error?.code === 'ABORT_ERR' || error?.name === 'AbortError';
}

function isDefaultAbortReason(reason) {
  return reason?.name === 'AbortError' && reason?.message === 'This operation was aborted';
}

export function abortReason(signal, message = 'Process interrupted') {
  if (!signal?.aborted || signal.reason === undefined || isDefaultAbortReason(signal.reason)) {
    return new AtbError('ABORT_ERR', message);
  }
  return signal.reason;
}

function appendBounded(chunks, chunk, maxBytes, state) {
  const remaining = maxBytes === Infinity ? chunk.length : Math.max(0, maxBytes - state.bytes);
  if (remaining < chunk.length) state.truncated = true;
  const kept = chunk.subarray(0, remaining);
  if (kept.length > 0) {
    chunks.push(kept);
    state.bytes += kept.length;
  }
}

function terminateTree(child, killTree) {
  if (!child?.pid) return { killedTree: false, killMethod: null };
  if (!killTree) {
    child.kill('SIGTERM');
    return { killedTree: false, killMethod: 'child.kill' };
  }
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.unref();
      return { killedTree: true, killMethod: 'taskkill' };
    } catch {
      child.kill();
      return { killedTree: true, killMethod: 'taskkill-fallback' };
    }
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
    return { killedTree: true, killMethod: 'process-group' };
  } catch {
    child.kill('SIGTERM');
    return { killedTree: true, killMethod: 'process-group-fallback' };
  }
}

export function runProcess(command, args = [], options = {}) {
  const {
    cwd,
    env,
    envMode = 'inherit',
    input,
    allowFailure = false,
    signal,
    timeoutMs = 0,
    maxOutputBytes = Infinity,
    killTree = false,
  } = options;
  const abortMessage = `${command} ${args.join(' ')} was interrupted`;
  if (signal?.aborted) return Promise.reject(abortReason(signal, abortMessage));
  return new Promise((resolve, reject) => {
    let settled = false;
    const resolveOnce = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    let child;
    let timer;
    let timedOut = false;
    let killedTree = false;
    let killMethod = null;
    const started = Date.now();
    const stdoutState = { bytes: 0, truncated: false };
    const stderrState = { bytes: 0, truncated: false };
    const childEnv = envMode === 'provided'
      ? (env ?? {})
      : envMode === 'empty'
        ? { ...(env ?? {}) }
        : { ...process.env, ...(env ?? {}) };
    try {
      child = spawn(command, args, {
        cwd,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: killTree && process.platform !== 'win32',
        signal,
      });
    } catch (error) {
      rejectOnce(signal?.aborted ? abortReason(signal, abortMessage) : interrupted(error) ? error : new AtbError('PROCESS_START_FAILED', `Failed to start ${command}: ${error.message}`));
      return;
    }
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => appendBounded(stdout, chunk, maxOutputBytes, stdoutState));
    child.stderr.on('data', (chunk) => appendBounded(stderr, chunk, maxOutputBytes, stderrState));
    child.on('error', (error) => rejectOnce(signal?.aborted ? abortReason(signal, abortMessage) : interrupted(error) ? error : new AtbError('PROCESS_START_FAILED', `Failed to start ${command}: ${error.message}`)));
    child.on('close', (code, terminationSignal) => {
      if (timer) clearTimeout(timer);
      const result = {
        command,
        args,
        code: code ?? 1,
        signal: terminationSignal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdoutTruncated: stdoutState.truncated,
        stderrTruncated: stderrState.truncated,
        timedOut,
        killedTree,
        killMethod,
        durationMs: Date.now() - started,
      };
      if (signal?.aborted) {
        rejectOnce(abortReason(signal, abortMessage));
        return;
      }
      if (timedOut && !allowFailure) {
        rejectOnce(new AtbError('PROCESS_TIMEOUT', `${command} ${args.join(' ')} exceeded ${timeoutMs}ms`, result));
      } else if (terminationSignal && !timedOut) {
        rejectOnce(new AtbError('ABORT_ERR', `${command} ${args.join(' ')} was terminated by ${terminationSignal}`, result));
        return;
      }
      if (!allowFailure && result.code !== 0) {
        rejectOnce(new AtbError('PROCESS_FAILED', `${command} ${args.join(' ')} exited with code ${result.code}`, result));
      } else {
        resolveOnce(result);
      }
    });
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        const termination = terminateTree(child, killTree);
        killedTree = termination.killedTree;
        killMethod = termination.killMethod;
      }, timeoutMs);
      timer.unref?.();
    }
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}
