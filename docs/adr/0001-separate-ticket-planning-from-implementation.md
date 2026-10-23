# Separate ticket planning from implementation

The spec automation's scope ends with publishing and verifying a ticket breakdown. Implementing the resulting tickets belongs to a separately designed workflow, so publication and `ready-for-agent` labels do not cause this system to execute implementation work.

An eligible source spec can carry `auto-approve` to authorize publication of the complete locally generated breakdown without interactive approval. Adding this label is the automation's approval signal; no separate comment command or draft-version approval protocol is required. Without the label, automatic publication is not authorized; whether automation prepares a draft or waits before drafting remains undecided. The repository's to-tickets skill retains its existing interactive approval process outside the automatic-approval exception. `reference-only` excludes an issue and every descendant regardless of approval or trigger labels.
