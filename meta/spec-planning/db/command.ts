import { execFile } from 'node:child_process';
import type { CommandRunner } from './github.types';

export const command: CommandRunner = (program, args, cwd, input) =>
  new Promise((resolve) => {
    const child = execFile(program, args, {
      cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => resolve({
      stdout, stderr: error?.killed ? `Command timed out. ${stderr}` : stderr || error?.message || '', failed: Boolean(error),
    }));
    child.stdin?.on('error', () => { /* execFile reports an exited child through its callback. */ });
    child.stdin?.end(input);
  });
