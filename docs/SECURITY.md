# Security & privacy

Implemented
- Passwords: bcrypt (cost 12); policy ≥10 chars, letters + digits. Timing-equalised login; lockout after 5 failures for 15 min; login rate limiting.
- Sessions: 15-min HS256 access token (HttpOnly, SameSite=Lax cookie) + 7-day refresh token stored as SHA-256 hash, rotated on every use; reuse of a rotated token revokes all of the user's sessions. Logout, logout-all, revoke on password reset / user disable / tenant suspension.
- CSRF: SameSite cookies + mandatory `X-Requested-With` header on state-changing requests + Origin allowlist. Webhooks use HMAC instead.
- Headers: helmet (CSP `default-src 'none'` on the API, frame-ancestors none), `Cache-Control: no-store` on API responses, CORS allowlist incl. tenant subdomains.
- Input: strict zod schemas (unknown fields rejected), parameterised SQL only, sort-column allowlists, JSON body size limit.
- Access control: tenant from session only; permission checks on the server; 404 for cross-tenant ids; composite FKs in SQL Server; privilege-escalation rules for role assignment and editing.
- Payments: server-side signature verification, signed idempotent webhooks, unique provider ids, sandbox blocked in production, secrets never sent to the browser.
- Audit logs for logins, failed logins, provisioning, patient create/view/update/archive, appointments, staff, users/roles, settings, subscription, admin actions. Metadata is sanitised (no passwords, tokens, clinical text).
- Errors never expose SQL text or stack traces (request id returned instead).

To do before production
- E-mail delivery for password reset and notifications; optional MFA (TOTP) for Owners and Super Admins.
- File uploads (lab reports): store outside web root / private object storage, serve via authorised endpoint or short-lived signed URL, type/size checks, malware-scanning hook, `TenantId` ownership + download audit.
- Least-privilege SQL login for the app (db_datareader/db_datawriter + EXECUTE; no db_owner) — use a separate login for migrations.
- Encryption at rest (TDE on SQL Server / Azure SQL), TLS everywhere (`Encrypt=True`, `TrustServerCertificate=False` in production).
- Backups with tested restores, monitoring/alerting, incident-response runbook.
- Legal: the platform has security controls but is **not "compliant" by itself**. Under India's **Digital Personal Data Protection Act, 2023** and its Rules, hospitals act as data fiduciaries and you as processor: you need a data-processing agreement, notices/consent flows, breach notification process, retention policy, and grievance contact. Review medical-record retention expectations (e.g. NMC/MCI guidance, state rules) and ABDM/NDHM standards if you integrate with them. Get a legal review.

Credentials hygiene
- `.env` is gitignored. Never commit real keys. **The database password used during setup was shared in a chat — rotate it.**
