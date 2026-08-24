import { spawn } from 'node:child_process';
import { AtbError } from './errors.mjs';

export function runProcess(command, args = [], options = {}) {
  const { cwd, env, input, allowFailure = false } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => reject(new AtbError('PROCESS_START_FAILED', `Failed to start ${command}: ${error.message}`)));
    child.on('close', (code, signal) => {
      const result = {
        command,
        args,
        code: code ?? 1,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (!allowFailure && result.code !== 0) {
        reject(new AtbError('PROCESS_FAILED', `${command} ${args.join(' ')} exited with code ${result.code}`, result));
      } else {
        resolve(result);
      }
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}
