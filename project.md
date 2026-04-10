Project: Neighborhood Intelligence MVP

Stack:
- SvelteKit
- TypeScript
- Tailwind
- MapLibre
- Hetzner
- Coolify
- NodeJS
- Neon/Postgres/PostGIS
- Mapillary
- MapTiler

Product rules:
- No sign-in/sign-up in MVP.
- Clerk is integrated behind a feature flag only.
- No scraping of listing sites.
- No legal, financial, or tax advice.
- Do not claim hard safety/crime facts; use soft wording.
- Country scope is Portugal.
- Map is the primary interface.
- Overlay panels should not block core map interactions unnecessarily.

Architectural preferences:
- Keep frontend thin when logic belongs on the server.
- Use typed payloads between frontend and backend.
- Keep geospatial logic explainable and deterministic.
- Do not introduce backward compatibility shims.
- Favor direct implementation over framework-heavy patterns.