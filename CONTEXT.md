# Spec ticket planning

The language used to turn source specifications into reviewable implementation work.

## Language

**Source spec**:
The authoritative requirements issue from which a ticket breakdown is derived.
_Avoid_: Implementation ticket

**Ticket breakdown**:
The complete set of grouping issues, implementation tickets, parent relationships, and blocking dependencies derived from a source spec.

**Grouping issue**:
A container for implementation or review tickets, rather than an executable work item.

**Automatic approval**:
Authorization through the source spec's `auto-approve` label to publish its complete ticket breakdown without a human draft-approval step.
_Avoid_: Implementation approval

**Reference-only issue**:
An example issue excluded from automated work, together with every descendant, regardless of other labels.
