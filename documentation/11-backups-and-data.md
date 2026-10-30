# 11. Backups & data safety

There are **two levels** of backup. Use both.

## Level 1 — Server backups (by whoever runs the database)

The whole database (all hospitals) should be backed up automatically by the database host — e.g. daily full backups kept for 30 days. This protects against hardware failure or accidental damage. See [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) for SQL Server backup and restore commands. **This is the platform owner's responsibility.**

## Level 2 — Hospital data download (Administration → Backups)

Any hospital user with the *backups.manage* permission (Owner and Hospital Admin by default) can click **Download backup now**.

**What you get:** one `.json` file named like `green-valley-backup-2026-10-30T10-15-00.json` containing every table of **your hospital only**: patients, appointments, staff and schedules, consultations and prescriptions, admissions and beds, bills, payments, lab tests, packages, price history, orders, samples and results, medicines and stock, expenses, settings, users (without passwords), roles and the audit log.

**What is never included:** passwords, login sessions, password-reset codes, raw payment-gateway messages, and anything belonging to another hospital.

**Good to know**

- Works even when the subscription has **expired** — your data always remains yours.
- Each download is listed in *Download history* (date, who, tables, records, size) and written to the Audit log.
- To avoid overload, at most 3 downloads per minute per hospital.
- JSON is a standard text format that any developer, Excel (Power Query) or another system can read.
- **Restoring** from this file is not a self-service button (to avoid accidental overwrites) — contact the platform support team if you need data restored.

## Recommended routine for a hospital

| How often | What |
|-----------|------|
| Weekly | Download a backup and keep it in a safe, access-controlled place (e.g. encrypted drive or company cloud folder) |
| Before big changes | Download a backup (e.g. before bulk-editing tests or prices) |
| Monthly | Delete very old copies you no longer need — they contain patient data |

Next: [12. Troubleshooting & FAQ →](12-troubleshooting-faq.md)
