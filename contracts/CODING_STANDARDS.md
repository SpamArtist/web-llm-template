# Coding standards

## Backend ownership

Review new backend flows against [the backend architecture contract](BACKEND_ARCHITECTURE.md). Check ownership across files: HTTP adapters parse and map requests, use cases make application decisions and own transaction boundaries, persistence functions query data, and shared rules stay pure. Check that every tenant read and write in one atomic workflow receives the same tenant transaction. Replacing raw SQL with a query builder does not fix a query placed in the wrong module.

## Test independence

Tests must still run and validate product behavior if `prototype/` is removed. Build test inputs and expected results from documented product contracts or independently authored fixtures. Do not copy or derive fixtures, baselines, or expected values from prototype code, sample data, screenshots, or runtime output.

When reviewing a test change, check where its fixtures and expected values came from. A passing test is insufficient if its expected result came from a prototype. Direct references are blocked by CI; review must catch copied or derived dependencies.
