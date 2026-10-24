# Spec ticket planning

The language used to turn source specifications into reviewable implementation work.

## Language

**Local planning workflow**:
The recurring ticket-planning arrangement for one repository in one local Codex profile, scheduled independently of any existing chat. Additional checkouts of that repository in the same profile share this workflow.

**Local Codex profile**:
The persistent local Codex environment on one machine that defines the app-instance boundary for planning. Its planning workflows are shared across windows and survive app restarts; separate profiles have separate workflows.

**Planning setup**:
Establishment of a local planning workflow, complete when its prerequisites are satisfied and its recurring schedule is confirmed active.

**Planning checkout**:
The registered checkout used by a local planning workflow for its commands and saved drafts. Additional checkouts share the workflow without replacing its planning checkout.

**Ticket planning**:
The work of reading a source spec and repository, preparing a ticket breakdown, and publishing and verifying approved tickets. It does not include implementing those tickets.

**Planning session**:
The work on one spec's ticket breakdown, including waits and recovery, through verified publication. One machine and Codex app instance own the session.

**Planning run**:
One scheduled or manual invocation within a planning session. Its eligibility and approval state are fixed when the run starts.

**Ownership record**:
The shared GitHub record that identifies the machine and Codex app instance responsible for a spec's planning session.

**Ownership transfer**:
A change of the planning session's owner after an explicit user request. An offline owner does not cause an automatic transfer.

**Source spec**:
The authoritative requirements issue from which a ticket breakdown is derived.
_Avoid_: Implementation ticket

**Ticket breakdown**:
The complete set of grouping issues, implementation tickets, parent relationships, and blocking dependencies derived from a source spec.

**Draft breakdown**:
A complete ticket breakdown prepared for publication but not yet published.

**Published breakdown**:
A ticket breakdown whose issues and relationships have been published and verified in the tracker.

**Orchestrator chat**:
The coordinating chat for one source spec's published implementation tickets, including their dependencies and independent final review.
_Avoid_: Planning session

**Orchestrator handoff**:
The transition from a verified published breakdown to its separate Orchestrator chat. Publication can be complete while handoff still awaits a prerequisite.

**Integration branch**:
The branch that gathers verified implementation work for one source spec before any separately authorized merge to the project’s main branch.

**Integration base**:
The branch from which a source spec’s integration branch begins.

**Implementation chat**:
A separate chat responsible for one implementation ticket's user stories and acceptance criteria.
_Avoid_: Orchestrator chat, planning run

**Implementation ticket set**:
The exact implementation tickets belonging to one published breakdown. A first-to-last issue-number range is only a summary, not membership.

**Revision request**:
An explicit request to change a previously published breakdown, distinct from an ordinary invocation that checks completion.

**Grouping issue**:
A container for implementation or review tickets, rather than an executable work item.

**Automatic approval**:
Authorization through the source spec's `auto-approve` label to publish its complete ticket breakdown without a human draft-approval step.
_Avoid_: Implementation approval

**Reference-only issue**:
An example issue excluded from automated work, together with every descendant, regardless of other labels.
