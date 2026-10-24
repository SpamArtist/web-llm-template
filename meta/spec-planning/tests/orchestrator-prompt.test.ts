import { describe, expect, it } from 'vitest';
import { handoffMarker, implementationTickets, integrationBase, integrationBranch, renderOrchestratorPrompt, validateBranchName } from '../shared/orchestrator-prompt.js';

const input = { repo: 'example/template', sourceNumber: 12, tickets: [83, 19, 57], baseBranch: 'release/v2', integrationBranch: 'LLM/spec-12-integration', marker: 'spec-orchestrator:example/template:12:session-1' };

describe('orchestrator handoff contract', () => {
  it('includes new and reused exact ticket identities, excludes grouping issues, and sorts only display bounds', () => {
    expect(implementationTickets({ implementation: { number: 50 }, 'ticket:new': { number: 83 }, 'ticket:reused': { number: 19 }, 'code-review': { number: 84 } })).toEqual([19, 83]);
    const prompt = renderOrchestratorPrompt(input);
    expect(prompt).toContain('GitHub issues #19 to #83');
    expect(prompt).toContain('Exact implementation tickets: #19, #57, #83.');
    expect(prompt).toContain('do not include unrelated issues between them');
    expect(input.tickets).toEqual([83, 19, 57]);
  });
  it('preserves execution responsibilities and approved launch constraints in the initial prompt', () => {
    const prompt = renderOrchestratorPrompt(input);
    for (const required of [
      'Source spec: example/template#12', 'Reconciliation marker: spec-orchestrator:example/template:12:session-1',
      'Start implementation immediately', 'authorizes creating, messaging, coordinating, and following up',
      'local branch LLM/spec-12-integration', 'initial base is release/v2', 'DO NOT MERGE TO MAIN',
      'Each sub-issue should be started in a new chat session', 'gpt-6-luna', 'Extra High (xhigh)',
      'Do not create all chat sessions at once', 'no fixed maximum', 'multiple agents', '$caveman ultra',
      'Respect the dependency graph', 'not blocked by any other pending issue', 'pass required checks',
      'new branch in a separate worktree based on the integration branch', 'user stories', 'acceptance criteria',
      'every 5 mins', 'scheduled task inside the main Orchestrator chat', 'available scheduling tool directly',
      'Read OpenAI Docs only if the tool fails', 'Keep unchanged or non-actionable scheduled checks quiet',
      'mark it awaiting user, stop the five-minute poll', 'exactly what needs approval', 'Resume the task when the user responds',
      'Decide how this affects dispatch', 'Update status of all related issues', 'Decide the appropriate issue status transitions',
      'independent check of code changes against spec in a new chat but do not fix them',
    ]) expect(prompt).toContain(required);
    expect(prompt).not.toContain('<implementation ticket #>');
    expect(prompt).not.toContain('<local_branch_name>');
  });
  it.each([[], [1, 1], [0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1]].map((tickets) => ({ tickets })))('rejects invalid ticket list $tickets', ({ tickets }) => {
    expect(() => renderOrchestratorPrompt({ ...input, tickets })).toThrow();
    expect(() => implementationTickets(Object.fromEntries(tickets.map((number, index) => [`ticket:${index}`, { number }])))).toThrow();
  });
  it('uses stable identity scoped to repository, spec, and planning session', () => {
    expect(handoffMarker('example/template', 12, 'session-1')).toBe(input.marker);
    expect(handoffMarker('example/template', 12, 'session-2')).not.toBe(input.marker);
    expect(handoffMarker('example/template', 13, 'session-1')).not.toBe(input.marker);
    expect(integrationBranch(12)).toBe('LLM/spec-12-integration');
    expect(() => integrationBranch(0)).toThrow();
  });
});

describe('integration base metadata', () => {
  it('defaults to main and accepts a custom standalone branch declaration', () => {
    expect(integrationBase('## Spec\nRequirements')).toBe('main');
    expect(integrationBase('## Spec\nIntegration base: release/v2\nRequirements')).toBe('release/v2');
  });
  it.each(['Integration base: main\nIntegration base: main', 'Integration base: ', 'Integration base: main extra', 'Integration base:main', ' Integration base: main'])('rejects ambiguous or malformed declaration %s', (body) => {
    expect(() => integrationBase(body)).toThrow();
  });
  it.each(['-main', 'HEAD', 'refs/heads/main', '../main', 'topic..next', 'topic.lock', 'topic/.hidden', 'topic//next', 'main~1', 'main^{commit}', 'main@{1}', 'main;touch', '$(touch)', '`touch`', 'main\nnext'])('rejects unsafe branch %s', (branch) => {
    expect(() => validateBranchName(branch)).toThrow();
  });
});
