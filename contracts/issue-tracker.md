# Tracker and approved requirements

## Project initialization

Choose one canonical tracker and identify the approved requirements before implementing work. For a generated repository hosted on GitHub, the default tracker is GitHub Issues. During initialization, replace the selections below with the project's choices:

- **Tracker:** GitHub Issues for this repository.
- **Approved spec location:** Not selected yet. Record the approved implementation issue URL or another canonical requirements location before starting implementation. For multiple tasks, identify the approved issue or spec for each task at that source.

**Customization point:** Teams using another tracker must replace these selections with its name, location, and approved-spec convention. If requirements live outside the tracker, link each work item to that authoritative spec. Keep one authoritative requirements source for each task.

## GitHub workflow

Use the `gh` CLI for issue operations. Determine the repository from `git remote get-url origin`; never hard-code the template repository's slug. Run `gh` from that checkout, or pass `--repo` with the owner/repository derived from `origin` when explicit selection is needed.

Read the approved issue or spec before implementation. Record requirement amendments and implementation decisions at that source so its current requirements remain authoritative. Durable documentation should link to it rather than copy an evolving issue body into `docs/`.

When completing work, leave the commands, outcomes, and available CI link with the issue or canonical work item, following the [verification contract](verification.md).
