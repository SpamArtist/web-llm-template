# Backend architecture

Use these module paths for new Node/TypeScript backend flows. The template has no `src/` tree yet; create modules when a workflow needs them.

`HTTP adapter → use case → persistence functions → database`

- `src/server/http/`: transport adapters authenticate at the HTTP edge, parse requests, call a use case, and map typed outcomes to HTTP responses. They do not import database modules or build queries.
- `src/server/use-cases/`: application operations own business decisions and the transaction boundary. They coordinate validation, state changes, and persistence functions, then return typed outcomes without Express types. They do not import query libraries or table schemas.
- `src/db/`: persistence functions own SQL, ORM queries, and table access. Tenant-aware functions accept the use case's tenant transaction; they do not start another transaction inside the same atomic workflow.
- `src/shared/`: pure calculations, validation, and shared value types have no database or Express dependencies.

For tenant data, bind authenticated tenant identity before access. Put transaction setup in `src/db/client.ts` and expose a narrow `TenantTransaction` type from `src/db/tenant-transaction.ts` for use cases. Pass the same tenant transaction to every persistence function involved in one atomic workflow. Authentication bootstrap can use a separate, non-tenant database path before tenant identity exists. Keep database constraints and access policies as final enforcement for concurrent requests.

Expose narrow persistence operations that hide useful query details; do not add a generic repository interface solely to wrap one database implementation. Changing SQL syntax or replacing raw SQL with a query builder does not move query ownership out of `src/db/`.

ESLint restricts imports from `src/server/http/` and `src/server/use-cases/`. If path aliases are introduced, update those restrictions to cover the new import specifiers.
