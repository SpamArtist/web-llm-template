# Separate ticket planning from implementation

The spec automation's scope ends with publishing and verifying a ticket breakdown. Implementing the resulting tickets belongs to a separately designed workflow, so publication and `ready-for-agent` labels do not cause this system to execute implementation work.

An eligible source spec can carry `auto-approve` to authorize publication of the complete locally generated breakdown without interactive approval. Without that label, the repository's to-tickets skill retains its draft-review requirement. This permits unattended publication by explicit opt-in while preserving the same drafting and verification requirements in both modes. `reference-only` excludes an issue and every descendant regardless of approval or trigger labels.
