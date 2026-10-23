import type { BootstrapContext, WorkflowRecord } from './bootstrap.types.js';
export function githubRepository(origin: string): string;
export function checkoutIdentity(cwd: string): { checkout: string; repository: string };
export function validateRecord(record: unknown, repository: string): WorkflowRecord;
export function readRecord(path: string, repository: string): WorkflowRecord | null;
export function getBootstrapContext(cwd?: string, env?: NodeJS.ProcessEnv): BootstrapContext;
