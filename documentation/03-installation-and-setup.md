# 3. Installation & setup (step by step)

This chapter is written for someone setting the software up on a **Windows computer** for the first time. Commands are typed in **VS Code → Terminal → New Terminal** (or Command Prompt / PowerShell).

## What you need first

| Thing | Why | How to get it |
|-------|-----|---------------|
| **Node.js 22.9 or newer** | Runs the backend and builds the screens | Download "LTS" from nodejs.org and install. Check with `node -v` |
| **A SQL Server database** | Stores all data | Hosted (e.g. site4now / Azure SQL) or local SQL Server Express. Needs SQL Server 2017 or newer |
| **The project folder** | The code | e.g. `C:\Users\<you>\Desktop\Hospital-management-system` |
| **VS Code** (optional) | Easy editing & terminal | code.visualstudio.com |

## The project has two parts

```
Hospital-management-system/
├── backend/     ← the server ("brain")  — runs on http://localhost:5000
├── frontend/    ← the screens            — runs on http://localhost:5173
├── database/    ← SQL scripts that create the tables
├── docs/        ← technical documents
└── documentation/  ← this guide
```

Both parts must be running at the same time, each in **its own terminal window**.

## Step 1 — Create the settings file (`backend/.env`)

The backend reads its secret settings from a file called `.env` inside the `backend` folder.

1. In the `backend` folder, copy `.env.example` and rename the copy to `.env`.
2. Open `.env` and fill in at least these lines:

```ini
DB_CONNECTION_STRING="Data Source=YOUR_SERVER;Initial Catalog=YOUR_DATABASE;User Id=YOUR_USER;Password=YOUR_PASSWORD;Encrypt=True;TrustServerCertificate=True;"
JWT_SECRET=<a long random text, at least 32 characters>
SUPERADMIN_EMAIL=you@yourcompany.com
SUPERADMIN_PASSWORD=<a strong password>
PAYMENT_PROVIDER=sandbox
```

- **DB_CONNECTION_STRING** — where the database is and how to log in to it. Your hosting company gives you these values.
- **JWT_SECRET** — a long secret used to sign logins. Create one by running:
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` and paste the output.
- **SUPERADMIN_EMAIL / PASSWORD** — the login for the platform owner's portal (`/admin/login`).
- **PAYMENT_PROVIDER=sandbox** — a *test* payment screen for local use. For real money see [chapter 9](09-plans-and-subscription.md#real-online-payments-razorpay).

> ⚠️ **Never share or upload `.env`.** It contains passwords. It is already excluded from Git.

## Step 2 — Start the backend

```bash
cd backend
npm install            # downloads the libraries (only needed the first time / after updates)
npm run db:migrate     # creates or updates all database tables
npm run db:seed        # adds permissions, roles, default data and your Super Admin login
npm run db:seed:demo   # OPTIONAL: two demo hospitals for practice (never on a live server)
npm run dev            # starts the server
```

When it works you will see something like:

```
✓ Database connected …
API listening on http://localhost:5000
```

Leave this terminal open.

### What do these commands do?

| Command | Meaning |
|---------|---------|
| `npm install` | Downloads the building blocks the software needs |
| `npm run db:migrate` | Runs the SQL scripts in `database/migrations` in order (001, 002, 003, 004, 005…). Each script runs once; already-applied scripts are skipped. **Run it again after every update.** |
| `npm run db:seed` | Fills in permissions and roles, gives older hospitals any new defaults, and creates the Super Admin. Safe to run again. |
| `npm run db:seed:demo` | Creates practice hospitals *Green Valley* and *Blue Care* with sample patients, beds and medicines |
| `npm run dev` | Starts the server and restarts it automatically when code changes |

## Step 3 — Start the frontend (screens)

Open a **second** terminal:

```bash
cd frontend
npm install
npm run dev
```

You will see `Local: http://localhost:5173/`. Open that address in Chrome.

## Step 4 — Log in

| What | Address | Login |
|------|---------|-------|
| Public website | `http://localhost:5173` | — |
| Super Admin portal | `http://localhost:5173/admin/login` | the `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` from `.env` |
| Demo hospital 1 | `http://localhost:5173/login` | workspace `green-valley`, e-mail `owner@green-valley.demo`, password `DemoPass123!` |
| Demo hospital 2 | `http://localhost:5173/login` | workspace `blue-care`, e-mail `owner@blue-care.demo`, password `DemoPass123!` |

To create a **real new hospital** locally: open Pricing → choose a plan → Register → on the test payment screen click *Pay* → you land inside your new hospital.

## After you receive an update

Every time new code arrives (for example new modules), run in order:

```bash
cd backend
npm install
npm run db:migrate
npm run db:seed
npm run dev

# new terminal
cd frontend
npm install
npm run dev
```

`db:seed` is important after updates: it gives existing hospitals the **new permissions** (for example access to Expenses or Backups) so the new menu items appear.

## Going live (production) — summary

Full details are in [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md). In short:

1. Use a real domain with **HTTPS**.
2. In `.env` set `NODE_ENV=production`, `COOKIE_SECURE=true`, your real `PUBLIC_APP_URL`, `CORS_ORIGINS` and `APP_BASE_DOMAIN`.
3. Set `PAYMENT_PROVIDER=razorpay` with your Razorpay **API keys** (the server refuses to start in production with the sandbox).
4. Build the screens with `npm run build` in `frontend` and serve the `dist` folder.
5. Run the backend with `npm start` under a process manager (PM2, Windows service, Docker…).
6. Turn on automatic database backups at your database host.

Next: [4. Hospital user guide →](04-hospital-user-guide.md)
