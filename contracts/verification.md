# Verification records

Record issue-specific verification on the relevant issue in the project's [canonical tracker](issue-tracker.md). Include the exact commands executed, their outcomes, and the CI run URL when a run exists. Identify checks that failed, were skipped, or could not run; do not describe unrun checks as passing. If CI has not run, say so instead of inventing a link.

For projects without GitHub Issues, use the chosen tracker or the CI run as the verification record. Keep the result with the approved work so reviewers can find the requirements, decisions, and validation together.

Keep screenshots, traces, response captures, and similar output in ignored test-output locations or attach them as CI artifacts. Follow the owning [generated-evidence rule](../AGENTS.md#generated-evidence), including its exception for deliberately maintained visual baselines and fixtures.

Do not create a tracked verification report for each issue. Tracked documentation describes repeatable procedures and lasting product contracts; update it only when those procedures or contracts change.
