# 12. Troubleshooting & FAQ

## Common errors and fixes

| What you see | What it means | Fix |
|--------------|---------------|-----|
| `Failed to resolve import "react-toastify"` (or any other package) in the browser | A library is missing in `frontend` | In `frontend` run `npm install`, then `npm run dev` again |
| `Cannot find package 'express'` (or similar) in the backend terminal | Backend libraries not installed | In `backend` run `npm install` |
| `Failed to connect to <server>:1433 in 30000ms` | The backend can't reach the database | Check internet; check `DB_CONNECTION_STRING`; make sure the database host allows remote connections from your IP (many hosts need your IP added in their control panel); try again — the server retries 3 times |
| `Login failed for user …` | Wrong database user/password | Fix the values in `DB_CONNECTION_STRING` |
| `Tables not found. Run: npm run db:migrate …` / `Invalid object name 'hms.…'` | Database tables are not created or not up to date | `npm run db:migrate` then `npm run db:seed` |
| `Migration 00X failed: …` | One SQL script stopped (it is rolled back automatically) | Read the message; fix the cause (often permissions or an old SQL Server version); run `npm run db:migrate` again |
| `! 00X_….sql was modified after being applied` | An already-applied SQL script was edited | Never edit applied scripts; restore the original file and put changes in a new numbered script |
| Red pop-up *"Server error: …"* (development) | The backend hit a problem | Read the backend terminal — it prints the real reason |
| `401` / you are sent back to login | Session expired or wrong login page | Log in again. Hospital users use `/login`; the Super Admin uses `/admin/login` |
| *"Invalid e-mail or password"* for the demo hospital | Demo data not created | `npm run db:seed:demo` (local/test only) |
| Menu item shows **Upgrade** | The module is not in your plan | Subscription → change plan |
| *"Your role does not include access…"* or a menu item is missing | Your role lacks the permission | Ask the owner/admin to adjust your role; after a software update the admin should run `npm run db:seed` |
| *"Subscription expired… read-only"* | Plan end date + grace days passed | Owner → Subscription → Renew |
| *"This record is used elsewhere, so it cannot be deleted"* | It has history (e.g. a test that was ordered) | Mark it **inactive** instead — history must stay correct |
| *"… is included twice"* when placing a lab order | A test is selected individually and inside a package | Untick the individual test |
| *"Payments can only be recorded against a finalised bill"* | The bill is still a draft | Finalise the bill first |
| Port `5000` or `5173` already in use | Another copy is already running | Close the other terminal, or restart the computer |

## FAQ

**Can two hospitals see each other's data?**
No. See [chapter 10](10-security-and-privacy.md). Even the Super Admin can't see patient data.

**Do we lose data if we don't renew?**
No. The hospital becomes read-only; data stays and can be downloaded. Renewing unlocks everything.

**Can we use it on a phone or tablet?**
Yes, the screens adapt to small screens. Tables scroll sideways on phones.

**Can we change a bill after printing it?**
Not after finalising. Issue a refund or cancel the bill (with reason) and create a new one. This protects against fraud and keeps accounts correct.

**Why can't I edit a package price on the edit screen?**
Package prices change only through *Price history*, so every change has a date, reason and person.

**Why do some tests appear in a grey "in package" state when ordering?**
They are already inside a package you ticked; ordering them separately would charge twice.

**Can a hospital have more than one branch?**
Multi-branch is planned for the Enterprise plan; it is not available yet.

**Where do I change the hospital name/address printed on bills and lab reports?**
Administration → Settings.

**Can I export to Excel?**
Yes — Reports → choose a report → *Export CSV* (needs the *reports.export* permission). For everything at once, use Backups.

**We shared passwords/keys in a chat or e-mail. What now?**
Change them: the database password (at your host), `SUPERADMIN_PASSWORD` (log in and change it, or update `.env` and reseed), and generate a new `JWT_SECRET` (everyone will need to log in again).

Next: [13. Glossary →](13-glossary.md)
