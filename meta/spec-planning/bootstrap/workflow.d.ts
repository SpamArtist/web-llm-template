import type { BootstrapContext, BootstrapOptions } from './bootstrap.types.js';
export function executeBootstrap(command: string, options?: BootstrapOptions, cwd?: string, env?: NodeJS.ProcessEnv): BootstrapContext & { allowed?: boolean };
