# 0010 · Deliberately deferred

Status: Accepted, to revisit.

| Item                                       | Why deferred                                                                                  | What exists today                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| SSO (SAML/OIDC), SCIM                      | Not needed for a single internal organisation at launch; adds an identity-provider dependency | Local accounts with Argon2id, lockout, session revocation, admin-managed users                                                  |
| Multi-tenancy                              | The platform serves List Software only                                                        | Per-project isolation of tickets, knowledge, credentials and roles                                                              |
| Installing Oracle Forms/Reports on workers | No licensed installation or sample modules available yet                                      | Adapter and parsers are complete; tools report "not configured" until `ORACLE_FORMS_BIN_DIR` / `ORACLE_REPORTS_BIN_DIR` are set |
| Deployment to client environments          | Agents must never deploy; releases go through existing CI/CD                                  | Release approval publishes a branch and opens a pull request                                                                    |
