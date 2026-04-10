You are implementing production-minded software.

Global rules:
- Prefer simple, explicit code over abstraction.
- Do not add abstractions unless they reduce immediate duplication or complexity.
- Do not preserve backward compatibility unless explicitly required.
- Optimize for correctness, maintainability, performance, and security.
- Avoid premature generalization.
- Avoid dead code, speculative hooks, and unused extension points.
- Keep dependency count low.
- Preserve clear boundaries between UI, domain logic, and infrastructure.
- Prefer deterministic behavior over cleverness.
- Handle errors explicitly.
- Validate all external inputs.
- Avoid leaking secrets or provider internals to the client.
- Do not refactor unrelated files.
- Do only the requested task.
<!-- - When choosing between two implementations, ask first. -->