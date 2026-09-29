# 0008 · Security model

## Decision

- Sessions: a signed JWT in an httpOnly, SameSite=Lax cookie (`lsa_session`), with a per-user session version that ends every session on password change or disable.
- CSRF: state-changing requests must carry the `x-lsa-client` header, which browsers will not send cross-site without CORS approval.
- Passwords: Argon2id; five failures lock the account for 15 minutes; sign-in errors do not reveal whether the email exists.
- Authorisation: per-project roles (viewer < requester < approver < admin) checked in the API for every call; workspace admins manage users and all projects. Projects can require an independent approver (four-eyes).
- Secrets: Git tokens, API keys and Oracle passwords are encrypted with AES-256-GCM under `MASTER_KEY`, never returned by the API and never placed in agent context.
- Sandbox: agents work in a per-run checkout with path confinement (including symlinks), read-before-edit, allow-listed executables run without a shell, and no `git push` or remote changes. SQL goes only to the configured sandbox schema, with bind variables.
- External intake uses per-project tokens stored as SHA-256 hashes and compared in constant time.

## Why

These are the controls a bank's security review expects by default, without adding SSO infrastructure yet (see 0010).

## Consequences

- Losing `MASTER_KEY` makes stored credentials unreadable; they must be re-entered.
- Rotating `JWT_SECRET` signs everyone out.
