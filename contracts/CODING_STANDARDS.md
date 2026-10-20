# Coding standards

## Type ownership

Put named TypeScript type aliases and interfaces in a dedicated `*.types.ts` file beside the feature that owns them. Test-local declarations belong beside their tests or in a test support owner's type file. Put types with the same meaning across features or layers in `src/shared/types/`; matching shapes alone do not make concepts shared. Import each type directly from its owning file with `import type` where applicable. A `*.types.tsx` file is also allowed when its declarations need TSX syntax. ESLint enforces declaration locations in `src/` and `tests/`.

## Backend ownership

Review new backend flows against [the backend architecture contract](BACKEND_ARCHITECTURE.md). Check ownership across files: HTTP adapters parse and map requests, use cases make application decisions and own transaction boundaries, persistence functions query data, and shared rules stay pure. Check that every tenant read and write in one atomic workflow receives the same tenant transaction. Replacing raw SQL with a query builder does not fix a query placed in the wrong module.

## Test independence

Tests must still run and validate product behavior if `prototype/` is removed. Build test inputs and expected results from documented product contracts or independently authored fixtures. Do not copy or derive fixtures, baselines, or expected values from prototype code, sample data, screenshots, or runtime output.

When reviewing a test change, check where its fixtures and expected values came from. A passing test is insufficient if its expected result came from a prototype. CI runs `bash scripts/check-test-isolation.sh` to block direct prototype paths and startup commands in tracked `tests/` files. This text search cannot detect copied or derived dependencies; review must catch them.
