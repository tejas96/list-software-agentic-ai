# List Software · Agentic Engineering Platform

An internal platform where a team of AI agents takes a requirement from a plain-language request to a tested, reviewed, releasable change, with people approving the plan and the release. It is built for List Software's banking systems (Oracle Forms, Oracle Reports, PL/SQL) and works for ordinary code repositories as well.

Every requirement becomes a ticket on a Jira-style board. Everything that happens to it (triage, analysis, plan, approvals, code changes, tests, defects found and fixed, release) is recorded on that ticket's timeline and in a tamper-evident audit trail, and can be exported as an evidence pack.

## How a change flows

1. **Log it.** Type the requirement on Home, create a ticket on the board, or have another system post it to the project's intake endpoint. It lands in _Backlog_ and is triaged: type, priority, acceptance criteria draft, duplicate check.
2. **Start a run.** From the ticket or by moving it to _Ready_ (automatic if the project enables it). The run follows the workflow for the ticket type: _Full change_, _Hotfix_ or _Analysis only_.
3. **Understand, analyse, plan.** Agents structure the requirement, trace impact through the knowledge graph (forms, reports, packages, tables and their dependencies), and write a plan.
4. **Plan approval.** An approver reads the plan and approves, sends it back with notes, or rejects it.
5. **Build and verify.** Agents change code on a sandbox branch, design and run tests, and loop test → fix until green. Each product defect QA finds is logged as a child bug ticket and fixed in the same run. A reviewer agent checks the change.
6. **Release approval.** The approver sees the review, test results and release notes; approving publishes the branch (and opens a pull request on GitHub) for your normal CI/CD. Agents never deploy.
7. **Evidence.** The ticket's evidence pack collects approvals, runs, artifacts and the full audit trail.

When an agent cannot continue safely (missing information, budget reached, tool unavailable), the run stops with an _escalation_ in the Approvals inbox instead of guessing.

## Architecture

```
            Browser ──► web (Next.js) ──proxy /api/v1, /socket.io──► api (NestJS)
                                                                     │   ▲
                                         start/signal workflows      │   │ LISTEN lsa_events
                                                                     ▼   │
 worker (Temporal) ◄──────── Temporal ◄─────────────────────────────┘   │
   │  agents (Claude) · knowledge sync · git sandbox · Oracle tools      │
   └────────────────────────────► Postgres 17 + pgvector ◄───────────────┘
                                   platform data, audit chain, knowledge graph, Temporal persistence
```

| Package              | Purpose                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/web`           | Next.js 16 UI: Home, board, tickets, runs, approvals, knowledge, agents, evidence, projects, users, audit |
| `apps/api`           | NestJS 12 REST API (`/api/v1`, OpenAPI at `/api/docs`) and Socket.IO realtime                             |
| `apps/worker`        | Temporal workers: SDLC run, triage, source sync, agent replies                                            |
| `packages/contracts` | Shared zod schemas, enums, lifecycle rules, workflows, agent catalog, permissions                         |
| `packages/db`        | Drizzle schema, SQL migrations, audit chain, credential encryption                                        |
| `packages/domain`    | Business operations shared by API and worker (tickets, notifications, knowledge search)                   |
| `packages/agents`    | LLM gateway, agent runner, tools, 15 skill packs (`skills/*/SKILL.md`)                                    |
| `packages/adapters`  | Sandboxed workspace (files, allow-listed commands, git) and Oracle adapter                                |
| `packages/knowledge` | Parsers for PL/SQL, Forms and Reports XML, Oracle dictionary and Graphify importers                       |

Design decisions and their reasons are in [`docs/adr`](docs/adr). Day-to-day operations are in [`docs/runbook.md`](docs/runbook.md).

## Run it locally

Prerequisites: Node.js 22, pnpm 10 (`corepack enable`), Docker.

```bash
cp .env.example .env
# Set JWT_SECRET (32+ chars) and MASTER_KEY (openssl rand -hex 32), the first admin's
# email and password, and ANTHROPIC_API_KEY to enable the agents.

pnpm install
pnpm infra:up          # Postgres 17 + pgvector, Temporal
pnpm build
pnpm db:migrate        # apply migrations
pnpm db:seed           # create the first administrator (only if there are no users)
pnpm dev               # api :4000, worker, web :3000
```

Open http://localhost:3000, sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, change the password under **Account**, then:

1. **Projects → New project** for each system you maintain.
2. In the project's settings: add people (**People**), store a Git token or Oracle credential (**Credentials**), and review approvals, budget and sandbox commands (**Workflow**).
3. **Knowledge → Connect** the repository (Forms/Reports XML exports, PL/SQL, code) and optionally the Oracle schema; the first sync builds the knowledge graph.
4. Log a requirement on **Home**.

Without `ANTHROPIC_API_KEY` everything except the agents works; runs stop with a clear "no LLM provider configured" escalation.

Temporal's web UI is optional: `docker compose -f infra/docker-compose.yml --profile ui up -d` serves it on http://localhost:8233.

## Deploy on one host

```bash
cp .env.example .env    # production secrets; DATABASE_URL and TEMPORAL_ADDRESS are set by compose
docker compose -f infra/docker-compose.yml --profile app up -d --build
```

This builds three images from the root `Dockerfile` (`--target api | worker | web`), runs migrations and the admin seed once, then starts the API, one worker and the web server on port 3000 (`WEB_PORT` to change). Put your TLS reverse proxy in front of the web container only: it proxies the API and the realtime socket, so the whole app is one origin.

To scale out, run more worker containers, each with its own stable `WORKER_ID` (or hostname) and its own workspaces volume; see the runbook.

## Configuration

All settings are environment variables, documented in [`.env.example`](.env.example). Validation runs at start-up and names every invalid value. Per-project behaviour (auto-triage, auto-start, workflow per ticket type, approval gates, independent approver, test-fix cycles, plan revisions, budget per run, allowed commands, test/build commands, base branch, working repository, Oracle sandbox schema) is edited in the UI under **Projects → Workflow**.

## Test and check

```bash
pnpm lint
pnpm typecheck
pnpm test        # unit tests everywhere; database, API and Temporal tests run when .env points at running services
```

The API end-to-end tests boot the compiled API against the real database; the worker tests run the SDLC workflow on a real Temporal server with scripted agents.

## Security in brief

- Sessions are httpOnly cookies; every state-changing request needs the `x-lsa-client` header (CSRF). Five failed sign-ins lock an account for 15 minutes. Changing a password or disabling a user ends their sessions.
- Access is per project: viewer, requester, approver, admin. Workspace admins manage users and every project.
- Git tokens and Oracle passwords are encrypted with AES-256-GCM (`MASTER_KEY`) and never returned by the API or shown to agents.
- Agents act only through tools: read/search the knowledge graph, edit files inside the run's sandbox checkout, run allow-listed executables without a shell, and run SQL only against the configured sandbox schema. They cannot push, deploy or reach production.
- The audit trail is append-only (enforced by database triggers) and hash-chained; **Audit log → Verify integrity** re-checks the whole chain.

## Oracle Forms and Reports

The Oracle adapter drives `frmf2xml`, `frmxml2f`, `frmcmp_batch` and `rwconverter` on the worker host. Install Oracle Forms/Reports there and set `ORACLE_FORMS_BIN_DIR` / `ORACLE_REPORTS_BIN_DIR`; until then those tools report "not configured" and agents work from the XML exports in the repository. PL/SQL compile and test use the project's sandbox schema (Oracle Instant Client is not required; the driver runs in thin mode).
