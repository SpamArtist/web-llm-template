import type { GitHub, Issue } from './planning.types';
import type { EligibilityResult } from './eligibility.types';

/** Evaluate once at session entry. Publication uses the saved approval snapshot. */
export async function eligibility(github: GitHub, repo: string, issue: Issue): Promise<EligibilityResult> {
  const approved = issue.labels.includes('auto-approve');
  const reject = (reason: string): EligibilityResult => ({ eligible: false, approved, reason });
  if (issue.state !== 'open') return reject('Source issue is closed.');
  if (!issue.labels.includes('spec') || !issue.labels.includes('ready-for-agent')) {
    return reject('Source issue requires spec and ready-for-agent labels.');
  }
  const template = repo.toLowerCase() === 'spamartist/web-llm-template';
  const visited = new Set<number>();
  let ancestor: Issue | null = issue;
  try {
    while (ancestor) {
      if (visited.has(ancestor.number)) return reject('Issue ancestry contains a cycle.');
      visited.add(ancestor.number);
      if (ancestor.labels.includes('reference-only') || (template && ancestor.number === 18)) {
        return reject('Source issue belongs to a reference-only tree.');
      }
      ancestor = await github.parent(ancestor.number);
    }
  } catch {
    return reject('Could not verify the complete issue ancestry.');
  }
  return { eligible: true, approved };
}
