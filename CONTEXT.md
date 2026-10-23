# Spec ticket planning

The language used to turn source specifications into reviewable implementation work.

## Language

**Ticket planning**:
The work of reading a source spec and repository, preparing a ticket breakdown, and publishing and verifying approved tickets. It does not include implementing those tickets.

**Planning session**:
The work on one spec's ticket breakdown, including waits and recovery, through verified publication. One machine and Codex app instance own the session.

**Planning run**:
One scheduled or manual invocation within a planning session. Its eligibility and approval state are fixed when the run starts.

**Source spec**:
The authoritative requirements issue from which a ticket breakdown is derived.
_Avoid_: Implementation ticket

**Ticket breakdown**:
The complete set of grouping issues, implementation tickets, parent relationships, and blocking dependencies derived from a source spec.

**Draft breakdown**:
A complete ticket breakdown prepared for publication but not yet published.

**Published breakdown**:
A ticket breakdown whose issues and relationships have been published and verified in the tracker.

**Revision request**:
An explicit request to change a previously published breakdown, distinct from an ordinary invocation that checks completion.

**Grouping issue**:
A container for implementation or review tickets, rather than an executable work item.

**Automatic approval**:
Authorization through the source spec's `auto-approve` label to publish its complete ticket breakdown without a human draft-approval step.
_Avoid_: Implementation approval

**Reference-only issue**:
An example issue excluded from automated work, together with every descendant, regardless of other labels.
