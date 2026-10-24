import type { OrchestratorPromptInput } from './orchestrator-prompt.types.js';

function issueNumber(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Issue numbers must be positive safe integers.');
}

export function validateBranchName(branch: string): string {
  // Deliberately narrower than Git refs: accept ordinary branch names, never revision expressions or shell text.
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes('..') || branch.endsWith('.')
    || branch.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.lock'))
    || branch === 'HEAD' || branch.startsWith('refs/')) {
    throw new Error('Invalid integration base or branch name.');
  }
  return branch;
}

export function integrationBase(sourceBody: string): string {
  const declarations = sourceBody.split(/\r?\n/).filter((line) => /^\s*Integration base\s*:/.test(line));
  if (declarations.length > 1) throw new Error('Ambiguous Integration base declarations.');
  if (!declarations.length) return 'main';
  const declaration = declarations[0].match(/^Integration base: ([^\s]+)\s*$/);
  if (!declaration) throw new Error('Integration base must be a standalone Integration base: <branch> line.');
  return validateBranchName(declaration[1]);
}

export function integrationBranch(sourceNumber: number): string {
  issueNumber(sourceNumber);
  return `LLM/spec-${sourceNumber}-integration`;
}

export function implementationTickets(published: Record<string, { number: number }>): number[] {
  const numbers = Object.entries(published).filter(([key]) => key.startsWith('ticket:')).map(([, record]) => record.number);
  validateTickets(numbers);
  return numbers.sort((a, b) => a - b);
}

function validateTickets(tickets: number[]): void {
  if (!tickets.length) throw new Error('Orchestrator requires implementation tickets.');
  tickets.forEach(issueNumber);
  if (new Set(tickets).size !== tickets.length) throw new Error('Duplicate implementation issue number.');
}

export function handoffMarker(repo: string, sourceNumber: number, planningSessionId: string): string {
  issueNumber(sourceNumber);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !/^[A-Za-z0-9_-]+$/.test(planningSessionId)) {
    throw new Error('Invalid orchestrator handoff identity.');
  }
  return `spec-orchestrator:${repo}:${sourceNumber}:${planningSessionId}`;
}

export function renderOrchestratorPrompt(input: OrchestratorPromptInput): string {
  validateTickets(input.tickets);
  issueNumber(input.sourceNumber);
  validateBranchName(input.baseBranch);
  validateBranchName(input.integrationBranch);
  const tickets = [...input.tickets].sort((a, b) => a - b);
  return `You are an orchestrator of work for GitHub issues #${tickets[0]} to #${tickets[tickets.length - 1]} in ${input.repo}.
Source spec: ${input.repo}#${input.sourceNumber}.
Exact implementation tickets: ${tickets.map((number) => `#${number}`).join(', ')}. The first/last numbers summarize this list; do not include unrelated issues between them.
Reconciliation marker: ${input.marker}. Reuse this Orchestrator and its recorded child chats on retries; never duplicate them.
Start implementation immediately. This request authorizes creating, messaging, coordinating, and following up with implementation chats and the final independent review chat.
Honor repository instructions, including specific personal-data transmission approvals; this orchestration authorization does not override them. Use gh CLI for GitHub operations, never the GitHub plugin.
- Use local branch ${input.integrationBranch} as an integration branch. Its initial base is ${input.baseBranch}; the handoff pins its starting commit before launch.
- DO NOT MERGE TO MAIN.
- Each sub-issue should be started in a new chat session.
- Each chat session should be GPT 6 Luna (gpt-6-luna) and reasoning Extra High (xhigh), including this Orchestrator and the independent review chat. If unavailable, report the missing capability; do not silently substitute settings.
- Do not create all chat sessions at once. Choose dispatch pacing; there is no fixed maximum number of simultaneous chats.
- Chat sessions can use multiple agents if required.
- Make sure to use $caveman ultra for work updates in all chats. If that skill is unavailable, use terse fragments, remove filler, and preserve technical substance.
- Respect the dependency graph present for every sub-issue.
- Only start a new session for a sub-issue when it is not blocked by any other pending issue. Dependencies must pass required checks and be merged into the integration branch before dependent work starts.
- Work from each GitHub issue should be done in a new branch in a separate worktree based on the integration branch, which will be merged into the integration branch.
- Make sure to instruct chats to cover all concerning user stories and pass all acceptance criteria.
- Make sure to poll active chats every 5 mins with a scheduled task inside the main Orchestrator chat. For routine Codex scheduling, use the available scheduling tool directly. Read OpenAI Docs only if the tool fails. Keep unchanged or non-actionable scheduled checks quiet; notify only on meaningful change, completion, failure, or required user action.
- When a task reaches a required human approval, mark it awaiting user, stop the five-minute poll, and send one message stating exactly what needs approval. Resume the task when the user responds. Decide how this affects dispatch and unrelated active work.
- Update status of all related issues once all work is completed. Decide the appropriate issue status transitions from verified results.
- After all sub-issues are completed make sure to run an independent check of code changes against spec in a new chat but do not fix them. Report findings; do not claim full spec completion while known gaps remain.
`;
}
