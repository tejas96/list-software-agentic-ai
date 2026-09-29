# Runbook

Operational tasks for the platform deployed with `infra/docker-compose.yml --profile app` (or the equivalent processes). Commands assume the repository root.

## Services

| Service    | Role                                                           | Health                                                         |
| ---------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| `web`      | UI; proxies `/api/v1` and `/socket.io/` to `api`               | `GET /login` returns 200                                       |
| `api`      | REST API, realtime socket, starts and signals workflows        | `GET /api/v1/health/ready` (checks the database)               |
| `worker`   | Runs workflows and activities: agents, sync, git, Oracle tools | Log line `Worker state changed … RUNNING` for both task queues |
| `postgres` | All data, including Temporal's                                 | `pg_isready`                                                   |
| `temporal` | Workflow engine                                                | `tctl cluster health`                                          |
| `migrate`  | One-off: migrations, then first admin                          | Exits 0                                                        |

The sidebar footer in the UI shows live-update, workflow-engine and LLM status at a glance.

## Start, stop, upgrade

```bash
docker compose -f infra/docker-compose.yml --profile app up -d --build   # start or upgrade
docker compose -f infra/docker-compose.yml --profile app ps
docker compose -f infra/docker-compose.yml --profile app logs -f api worker
docker compose -f infra/docker-compose.yml --profile app down             # stop (data volumes kept)
```

An upgrade rebuilds the images, runs `migrate` (it applies new migrations only), then restarts `api`, `worker` and `web`. Running workflows continue after the worker restarts.

**HTTPS is required in production.** With `NODE_ENV=production` the session cookie is marked `Secure`, so browsers only keep it over HTTPS (localhost excepted). Terminate TLS in your reverse proxy in front of `web`.

If Docker Hub is rate-limited or blocked, build from a mirror: `NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim docker compose … up -d --build`.

## Backups and restore

Postgres holds everything: the platform database (`lsa` by default) and Temporal's `temporal` and `temporal_visibility` databases. Back up all three together so run state and platform data agree.

```bash
for db in lsa temporal temporal_visibility; do
  docker compose -f infra/docker-compose.yml exec -T postgres pg_dump -U lsa -Fc "$db" > "backup-$db-$(date +%F).dump"
done
```

Restore into a stopped stack with `pg_restore --clean --if-exists -d <db>`, then start the app profile. Keep `MASTER_KEY` with the backups (separately and securely): without it stored credentials cannot be decrypted.

Worker workspaces (`workspaces` volume) are scratch checkouts and do not need backing up.

## Secrets

| Secret                                | Rotating it                                                                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                          | Change and restart `api`. Everyone is signed out.                                                                                                                                            |
| `MASTER_KEY`                          | Not rotatable in place. If it must change, set the new key, then re-enter each credential under **Projects → Credentials** (and re-select them in knowledge sources and the sandbox schema). |
| `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` | Change and restart `api` and `worker`.                                                                                                                                                       |
| Project intake token                  | **Projects → Intake → Issue new token**; the old one stops working at once.                                                                                                                  |
| Git tokens / Oracle passwords         | Add the new credential, point the source or sandbox at it, delete the old one.                                                                                                               |

## People and access

- **Add a user:** **Users → Add user** (workspace admins), then add them to projects under **Projects → People** with a role.
- **Locked out** (5 failed sign-ins): the lock clears after 15 minutes, or an admin resets their password under **Users**, which also clears the lock.
- **Leaver:** **Users → (person) → Can sign in: off**. Their sessions end immediately; their history stays in the audit trail.
- **Lost admin access:** if no admin can sign in, create a new admin with `pnpm db:seed` against an empty users table only. Otherwise promote a user directly in the database (`update users set is_admin = true where email = …`), which is recorded nowhere else, so note it in a ticket.

## Runs

| Symptom                               | What to do                                                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Run shows **Escalation** in Approvals | Read the reason. Fix the cause (add the missing information to the ticket, raise the budget in **Workflow**, configure the tool), then choose **Retry** on the escalation; or cancel the run.                      |
| Run waiting on a gate for too long    | Approvers get a notification; the Approvals inbox lists everything pending. Gates are re-checked every 5 minutes, so a decision is never lost.                                                                     |
| Run stuck in a step                   | Open the run: the step sheet shows the agent's progress and last activity. **Pause**, **Cancel** or **Retry** from the run page. The Temporal UI (`--profile ui`, port 8233) shows the workflow history in detail. |
| "No LLM provider is configured"       | Set `ANTHROPIC_API_KEY` for `api` and `worker`, restart, then retry the escalation.                                                                                                                                |
| Budget reached                        | Raise **Budget per run** in the project's Workflow settings, then retry. Costs per step are on the run page.                                                                                                       |
| Worker host lost                      | Runs keep their checkout on the host that claimed them. Bring the host back with the same `WORKER_ID` and volume; its runs continue. If it is gone for good, cancel and restart those runs.                        |

## Knowledge sources

- **Sync failed:** the source card on the Knowledge page shows the error (authentication, unreachable host, parse warnings). Fix the credential or URL and press **Sync now**. A sync already in progress is not started twice.
- **Objects missing:** Forms and Reports must be committed as XML exports (`frmf2xml`, `rwconverter`); binary `.fmb`/`.rdf` files are not parsed. PL/SQL and DDL are recognised by their usual extensions (`.sql`, `.pks`, `.pkb`, `.pck`, `.pls`, `.plb`, `.prc`, `.fnc`, `.trg`, `.spc`, `.bdy`, `.vw`, `.tab`, `.seq`, `.ddl`).
- **Semantic search:** set `EMBEDDINGS_PROVIDER=voyage` and `VOYAGE_API_KEY`, then sync again to embed existing chunks. Full-text search works without it.

## Scaling

- **More agent capacity:** add worker containers. Give each a unique, stable `WORKER_ID` (or hostname) and its own workspaces volume. `MAX_CONCURRENT_ACTIVITIES` limits parallel activities per worker.
- **API:** stateless; run several behind the web tier if needed. Realtime events reach every API instance through Postgres `LISTEN/NOTIFY`.
- **Database:** the usual Postgres tuning applies. The largest tables are `activities`, `chunks` and `llm_usage`.

## Audit and evidence

- **Verify the audit chain:** **Audit log → Verify integrity** (admins) or `GET /api/v1/audit/verify`. A broken chain names the first entry that fails; treat it as a security incident, since the table rejects edits and deletes at the database level.
- **Evidence for a change:** open the ticket → **Evidence pack**; print it or download the JSON.

## Oracle Forms and Reports tooling

1. Install Oracle Forms/Reports Builder on the worker host (or in a custom worker image based on this one).
2. Set `ORACLE_FORMS_BIN_DIR` (containing `frmf2xml`, `frmxml2f`, `frmcmp_batch`) and `ORACLE_REPORTS_BIN_DIR` (containing `rwconverter`), and add those executables to the project's allowed commands if they are not there.
3. Configure the project's Oracle sandbox schema (**Workflow → Oracle sandbox schema**) with a dedicated, non-production account.
4. Restart `api` and `worker` (both read these settings). The sidebar status then shows the Oracle tools as ready.
