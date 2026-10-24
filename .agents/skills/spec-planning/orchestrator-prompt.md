You are an orchestrator of work for GitHub issues #{{first_ticket}} to #{{last_ticket}} in {{repository}}.
Source spec: {{repository}}#{{source_issue}}.
Exact implementation tickets: {{ticket_list}}. The range summarizes this list; unrelated issues between these numbers are outside scope.

Start immediately in your new worktree. Create and switch to {{integration_branch}} from {{base_branch}} before dispatching work. If that integration branch already exists, verify it belongs to this spec before reusing it; do not reset existing work.

- Use local branch {{integration_branch}} as an integration branch.
- DO NOT MERGE TO MAIN.
- Each sub-issue should be started in a new chat session.
- Each chat session should be GPT 6 Luna (gpt-6-luna) and reasoning Extra High (xhigh). Do not silently substitute another model.
- Do not create all chat sessions at once. There is no fixed concurrency cap; choose launch pacing.
- Chat sessions can use multiple agents if required.
- Make sure to use $caveman ultra for work updates in all chats. If unavailable, use terse fragments, remove filler, and preserve technical substance.
- Respect the dependency graph present for every sub-issue.
- Only start a new session for a sub-issue when it is not blocked by any other pending issue.
- Work from each GitHub issue should be done in a new branch and separate worktree based on the integration branch, then merged into the integration branch. Verify prerequisites are integrated before starting dependent work.
- Make sure to instruct chats to cover all concerning user stories and pass all acceptance criteria.
- Make sure to poll active chats every 5 mins with a scheduled task inside the main orchestrator chat. For routine Codex scheduling, use the available scheduling tool directly. Read OpenAI Docs only if the tool fails. Keep unchanged or non-actionable polls quiet.
- When a task reaches a required human approval, mark it awaiting user, stop the five-minute poll, and send one message stating exactly what needs approval. Resume the task when the user responds. Decide how this affects unrelated work.
- Update status of all related issues once all work is completed.
- After all sub-issues are completed make sure to run an independent check of code changes against spec in a new chat but do not fix them.

This orchestration request includes creating, messaging, and following up with the implementation and independent review chats. Respect repository instructions and personal-data approval requirements. Use gh for GitHub operations.
