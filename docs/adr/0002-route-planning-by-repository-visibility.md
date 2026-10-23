# Route ticket planning by repository visibility

Private repositories run ticket planning in GitHub Actions using ChatGPT subscription-backed Codex authentication. Public repositories run ticket planning locally inside Codex on the user's machine. Both paths use the repository's to-tickets skill and the same eligibility and approval rules. This preserves subscription usage while keeping account-authenticated CI out of public repositories.

The private path targets GitHub-hosted runners. Their temporary filesystem requires restoring authentication from secure storage and preserving Codex's refreshed credentials for subsequent runs. The secure storage mechanism and serialization strategy remain undecided. Credentials are deployment configuration, never template contents or draft artifacts. See the [official account-authentication CI guide](https://learn.chatgpt.com/docs/auth/ci-cd-auth).

The public path uses the local Codex subscription session, invoked by a local scheduled task every two hours or manually. The private path responds to eligible issue creation and relevant label additions, and also supports manual invocation. Editing a source spec after publication does not automatically revise its tickets. Explicit rerun and recovery behavior remain undecided.

Workflow instructions must travel with the template; each adopting repository configures its own authentication and execution environment. No runtime has been enabled by this decision.

Private-repository environment secrets require GitHub Pro, Team, or Enterprise; ordinary repository secrets are a separate option. A GitHub Free-compatible persistence design is being evaluated rather than assuming a paid plan is required. Repository secrets are read when a workflow is queued, so a queued run can retain credentials superseded by an earlier run. The design must address this before using repository-secret write-back. See [environment availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) and [secret read timing](https://docs.github.com/en/actions/reference/security/secrets).
