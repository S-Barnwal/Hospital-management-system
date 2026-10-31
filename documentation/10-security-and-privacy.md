# 10. Security & privacy — how data is protected

Hospital data is sensitive. Here is what the software does, explained simply. (Technical details: [`docs/SECURITY.md`](../docs/SECURITY.md).)

## 1. Each hospital sees only its own data

| Protection | Plain meaning |
|------------|---------------|
| Hospital stamp on every row | Every patient, bill, sample… is labelled with its hospital's ID (`TenantId`) |
| Stamp comes from the login only | The server decides your hospital from your secure login, never from what the screen sends |
| Every query is filtered | The server always adds "only my hospital's rows" |
| Database-level locks | The database itself refuses to connect, say, a bill of Hospital A with a patient of Hospital B |
| Wrong ID = "not found" | Asking for another hospital's record looks exactly like asking for a record that doesn't exist — nothing leaks |
| Workspace address check | If you are logged into Hospital A but open Hospital B's web address, access is refused |

## 2. Logins

- Passwords are stored only as a **one-way scrambled code** (bcrypt) — nobody, not even the Super Admin, can read them.
- **5 wrong attempts** lock the account for 15 minutes; repeated attempts from one place are slowed down.
- After login you get two **secure cookies** the browser keeps hidden from scripts: a short one (15 minutes) and a refresh one. Refresh codes change on every use; if an old one is reused (a sign of theft), the session is cancelled.
- *Sign out* ends the session on the server too; disabling a user ends all their sessions.
- Hospital logins and Super Admin logins are completely separate.
- **2-step sign-in** (Settings): owners and admins also enter a 6-digit code e-mailed to them. Codes expire in 10 minutes, work once, and only 5 tries are allowed. The Super Admin can be protected the same way (`SUPERADMIN_MFA=true`).
- Password-reset links are e-mailed, work once and expire in 30 minutes.

## 3. Every action is checked

- **Permissions** are checked on the server for every action (see [chapter 8](08-roles-and-permissions.md)).
- **Plan check** — modules outside the plan are blocked on the server.
- **Input checking** — every form is validated on the server; unexpected fields are rejected (for example, you can't sneak in a different hospital ID).
- **Protection against fake requests from other websites** (CSRF) — requests must carry a special header and come from an allowed address.
- **No SQL injection** — the server never glues user text into database commands; values are always passed separately.

## 4. Records that must not change

- Finalised bills, payments and refunds can't be edited — corrections are new entries.
- Verified lab results are locked.
- Consultations keep every saved version.
- Patients are archived, not deleted.
- Important actions are written to the **Audit log** with user, time and IP address.

## 5. Messages and shared reports

- Lab report links are random 256-bit codes stored only as a hash, expire in 7 days, can be revoked, and require a one-time code sent to the patient's own phone/e-mail (5 tries per code, 5 codes per link, plus a per-device limit).
- The Message log keeps masked recipients only; message bodies are never written to production logs.
- A hospital's own SMTP password / WhatsApp token (Enterprise) is stored encrypted (AES-256-GCM), never returned by the API, and not written to the audit log; hospital-supplied SMTP servers on internal network addresses are refused.

- **TV display screens** open with a long random link (only its hash is stored, it can be removed at any time). The feed carries token numbers, queue/doctor names and rooms — never patient names, numbers or phone numbers.
- **Online booking** is off until the hospital switches it on. The public page lists doctors and free times only. Patients send a *request*; nothing touches patient records until staff confirm it (and staff decide whether a matching phone number is really the same person). Requests are rate-limited per network and per phone number, have a spam trap, and only a salted hash of the IP is kept.
- **Sign-in history** (who signed in, from which device/IP, failures and lock-outs) is visible to the hospital's admins for its own accounts and to the platform; it is kept 180 days.

## 6. Privacy between the platform and hospitals

- The Super Admin portal shows business information only — no patient data.
- **Support tickets** contain only what the hospital types; every form reminds staff not to include patient details. Support-team internal notes are never shown to the hospital, and a hospital can never see another hospital's tickets.
- **Branches** of a group stay separate workspaces. A user sees another branch's headline counts only if the same e-mail has an active account there with dashboard access — never patient-level data — and must sign in to that branch separately.
- Backups downloaded by a hospital contain only that hospital's data, and never passwords or login tokens.

## 7. What **you** must do

| Do | Why |
|----|-----|
| Keep `backend/.env` private; never upload it | It has the database password and secret keys |
| Use a long random `JWT_SECRET` and **change any password that was ever shared** in chat/e-mail | A leaked secret lets someone forge logins |
| Use HTTPS on the live server and `COOKIE_SECURE=true` | Encrypts traffic |
| Give each staff member their own login; never share | So the audit log is meaningful |
| Disable users who leave | Immediately removes their access |
| Store downloaded backups safely | They contain patient information |
| Turn on automatic backups at your database host | Protects against server failure |

Next: [11. Backups & data safety →](11-backups-and-data.md)
