# Route ticket planning by repository visibility

Private repositories run ticket planning in GitHub Actions using ChatGPT subscription-backed Codex authentication. Public repositories run ticket planning locally inside Codex on the user's machine. Both paths use the repository's to-tickets skill and the same eligibility and approval rules. This preserves subscription usage while keeping account-authenticated CI out of public repositories.

The private path targets GitHub-hosted runners. Their temporary filesystem requires restoring authentication from secure storage and preserving Codex's refreshed credentials for subsequent runs. The secure storage mechanism and serialization strategy remain undecided. Credentials are deployment configuration, never template contents or draft artifacts. See the [official account-authentication CI guide](https://learn.chatgpt.com/docs/auth/ci-cd-auth).

The public path uses the local Codex subscription session. Local triggering, scheduling, and recovery remain undecided. Workflow instructions must travel with the template; each adopting repository configures its own authentication and execution environment. No runtime has been enabled by this decision.
