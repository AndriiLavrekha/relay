import { spawn } from 'node:child_process';
import { AtbError } from './errors.mjs';

function interrupted(error) {
  return error?.code === 'ABORT_ERR' || error?.name === 'AbortError';
}

export function runProcess(command, args = [], options = {}) {
  const { cwd, env, input, allowFailure = false, signal } = options;
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
    try {
      child = spawn(command, args, {
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        signal,
      });
    } catch (error) {
      rejectOnce(interrupted(error) ? error : new AtbError('PROCESS_START_FAILED', `Failed to start ${command}: ${error.message}`));
      return;
    }
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => rejectOnce(interrupted(error) ? error : new AtbError('PROCESS_START_FAILED', `Failed to start ${command}: ${error.message}`)));
    child.on('close', (code, signal) => {
      const result = {
        command,
        args,
        code: code ?? 1,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (signal) {
        rejectOnce(new AtbError('ABORT_ERR', `${command} ${args.join(' ')} was terminated by ${signal}`, result));
        return;
      }
      if (!allowFailure && result.code !== 0) {
        rejectOnce(new AtbError('PROCESS_FAILED', `${command} ${args.join(' ')} exited with code ${result.code}`, result));
      } else {
        resolveOnce(result);
      }
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}
