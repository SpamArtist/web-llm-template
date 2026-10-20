# Local and CI checks

After `npm ci`, run `npm run check`. The baseline CI workflow runs that same command.

| Command | Current inputs |
| --- | --- |
| `npm run typecheck` | TypeScript configuration files for Vite, Vitest, and Playwright, plus any TypeScript added under `src/`, `tests/`, or `scripts/` |
| `npm run lint` | JavaScript and TypeScript files, including repository configuration and lint rules, plus application CSS when present |
| `npm run check` | Typecheck followed by lint; either failure fails the command |

The existing `tsconfig.json` checks real configuration files now, so typechecking is enabled even before application source exists. Extend its inputs and compiler options as the application grows; all new TypeScript application code must be covered by a `typecheck` script. JavaScript lint rules are linted, not typechecked.

The template has no application test suites yet. Vitest and Playwright configuration are starting points; no test runner is enabled in the baseline graph until tests exist. Do not use options such as `--passWithNoTests` to make an empty suite green.

## Adding tests

For each new suite, add a script that runs actual tests once and exits nonzero on failures or missing tests. For example, tests matching `tests/**/*.test.ts` can use `"test": "vitest run"`. Add the script to `npm run check` when it needs no external setup, and keep CI calling the same local command.

Suites requiring a browser, database, or other service need explicit setup documented by the generated project. Run their scripts in CI after that setup, in a separate job when appropriate, without adding those dependencies to baseline lint and typecheck. Do not enable a job before it has real tests. Use the same runner command locally and in CI.

The generated-evidence and test-isolation shell guards remain separate repository checks in the generated-evidence workflow. Run them locally with `bash scripts/check-generated-evidence.sh` and `bash scripts/check-test-isolation.sh` before committing.

## Enabling browser tests

1. Add product tests under `tests/ui/` and a script such as `"test:ui": "playwright test"`. Use a distinct filename pattern such as `*.spec.ts` for browser tests so the Vitest `*.test.ts` pattern does not run them.
2. Implement and document an application server command, or start the application independently. The template provides no `dev` script or application server.
3. Set `PLAYWRIGHT_WEB_SERVER_COMMAND` to the server command when Playwright should launch it. For example, once a working `dev` script exists, run `PLAYWRIGHT_WEB_SERVER_COMMAND='npm run dev' npm run test:ui`. With the variable unset, Playwright expects an already running application.
4. Set `PLAYWRIGHT_BASE_URL` to that application's URL. It defaults to `http://127.0.0.1:4173`; `WEB_PORT` changes the default port. Ensure the server actually listens at the chosen URL.
5. Install the required browser with `npx playwright install chromium` locally, or `npx playwright install --with-deps chromium` on a compatible CI runner. Add a browser job that installs dependencies, starts the configured server, and runs `npm run test:ui`.

Define any application-specific test environment in the generated project's server setup. Keep browser traces and reports in ignored runner output directories, following the [generated-evidence rule](../AGENTS.md#generated-evidence). Record commands and outcomes according to the [verification contract](verification.md).
