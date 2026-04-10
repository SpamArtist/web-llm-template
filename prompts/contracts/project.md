Project: Neighborhood Intelligence MVP

Stack:

Product rules:
- No sign-in/sign-up in MVP.
- Clerk is integrated behind a feature flag only.
- No legal, financial, or tax advice.
- Do not claim hard safety/crime facts; use soft wording.

Architectural preferences:
- Keep frontend thin when logic belongs on the server.
- Use typed payloads between frontend and backend.
- Keep geospatial logic explainable and deterministic.
- Do not introduce backward compatibility shims.
- Favor direct implementation over framework-heavy patterns.
