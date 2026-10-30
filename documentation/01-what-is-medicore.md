# 1. What is MediCore HMS?

## In simple words

MediCore HMS is software that helps a hospital, clinic or diagnostic lab **run its daily work on a computer instead of paper registers**:

- Who came today, which doctor they saw, and what was prescribed
- Which bed a patient is admitted to
- Which tests were done in the lab, and what the results were
- Which medicines are in stock and which are about to expire
- How much money came in, how much was spent, and who still owes money

It runs in a **web browser** (Chrome, Edge, Firefox) on a computer, tablet or phone. Nothing has to be installed on each computer in the hospital.

## Who uses it?

There are **two kinds of users**:

| User | What they do | Where they log in |
|------|--------------|-------------------|
| **Hospital users** — owner, admin, doctor, nurse, receptionist, lab technician, pharmacist, accountant | Do the hospital's daily work | `/login` |
| **Super Admin** — the company selling MediCore (Saitix Technologies) | Manage all hospitals that bought the software, plans, payments and demo requests | `/admin/login` |

These two logins are **completely separate**. A Super Admin password does not work on the hospital login, and the other way round.

## What is "SaaS" and "multi-tenant"?

- **SaaS (Software as a Service):** the hospital does not buy a CD or install a server. It **rents** the software monthly or yearly, and uses it online — like Netflix or Gmail.
- **Tenant:** each hospital that subscribes is called a *tenant*.
- **Multi-tenant:** one copy of the software and one database serve **many hospitals at once**.

### The apartment-building example

Think of MediCore as an apartment building:

- The **building** (the software and database) is shared — this keeps cost low.
- Each **hospital is a flat** with its own locked door.
- Hospital A can never open Hospital B's door. Even if someone in Hospital A types Hospital B's patient number into the address bar, the software simply says *"not found"*.

How this is guaranteed is explained in [chapter 10](10-security-and-privacy.md).

## What can a hospital do with it? (modules)

| Module | What it is for |
|--------|----------------|
| **Dashboard** | One-screen summary: today's appointments, beds, money collected, pending lab work, alerts |
| **Patients** | Register patients, search them, see their full history |
| **Appointments** | Book, reschedule, check-in and cancel appointments |
| **Doctors & staff** | Doctor list, departments, doctor timings (schedules) |
| **OPD** | Doctor's consultation notes and prescriptions |
| **Admissions & beds (IPD)** | Wards, beds, admit / transfer / discharge |
| **Pharmacy** | Medicines, stock batches with expiry, dispensing, suppliers |
| **Laboratory** | Lab orders, samples, results, verification, printed reports, tests, packages, referral doctors |
| **Billing** | Bills/invoices, receipts, refunds |
| **Payments** | One list of every receipt and refund |
| **Expenses** | Record the hospital's spending (rent, salaries, reagents…) |
| **Reports & Analytics** | Charts and downloadable reports; profit = income − expenses |
| **Users & roles** | Create staff logins and decide what each person may do |
| **Backups** | Download a full copy of the hospital's data |
| **Settings & Subscription** | Hospital details, plan, renewal, invoices |

Which modules a hospital gets depends on its **plan** (Starter / Professional / Enterprise) — see [chapter 9](09-plans-and-subscription.md).

## The public website

Before buying, a hospital sees the public website (green, white and gold design):

- **Home** — introduction and "Get Started" button
- **Features** — every module explained
- **Pricing** — Starter, Professional, Enterprise plans
- **Book a Demo** — a form where a hospital asks for a demo; the Super Admin sees it
- **Login / Register** — existing hospitals log in; new hospitals register and pay

Next: [2. How it works — the big picture →](02-how-it-works.md)
