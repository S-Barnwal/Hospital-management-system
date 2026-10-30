# 7. Super Admin (platform owner) guide

The **Super Admin portal** is for the company that sells MediCore (not for hospitals). Log in at **`/admin/login`** with the e-mail and password set in `backend/.env` (`SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`) and created by `npm run db:seed`.

> The Super Admin login and the hospital login are separate systems with separate cookies and a separate user table. Trying the admin password on `/login` will fail — that is by design. There is a link to the admin portal under the hospital login form.

## Menu

| Screen | What you can do |
|--------|-----------------|
| **Overview** | Number of hospitals, active subscriptions, revenue, new demo requests, recent sign-ups |
| **Hospitals (tenants)** | List every hospital; open one to see its plan, subscription dates, owner contact, usage counts; **suspend** or **reactivate** a hospital |
| **Plans** | Create/edit plans: name, monthly & annual price, tax %, user limits, which modules are included, "popular" badge, "contact sales" plans; delete unused plans |
| **Subscriptions** | All subscriptions with status (active / grace / expired) and end dates |
| **Payments** | All subscription payments received from hospitals (sandbox test payments are clearly labelled) |
| **Demo requests** | Requests from the *Book a Demo* form; change status (new → contacted → scheduled → completed / closed), add notes, delete |
| **Messages** | Messages from the *Contact* form |
| **Audit logs** | Platform-level actions (plan changes, suspensions, logins…) |
| **Settings** | Contact e-mail/phone/address and brand name shown on the public website |

## What the Super Admin **cannot** see

To protect patient privacy, the admin portal shows **business information only** (hospital name, plan, counts, payments). It does **not** show patient names, medical records, lab results or bills of any hospital. If a hospital needs help with its data, it can download a backup and share what is needed.

## Typical tasks

**A hospital asks for a demo**
1. Demo requests → open the request → call/e-mail them → set status *Contacted* and add a note.
2. To let them try: run `npm run db:seed:demo` on a **test** server only, or ask them to register on the Starter plan.

**Change prices**
Plans → edit → change monthly/annual price. Existing subscriptions keep their paid period; new prices apply on next purchase/renewal.

**A hospital didn't pay**
Nothing to do manually. After the end date it gets *grace days* (default 7), then becomes *read-only*. Their data is kept safely. When they renew, everything unlocks.

**Suspend a hospital** (e.g. abuse, legal request)
Hospitals → open → *Suspend* (a reason is required). Its users can no longer log in. *Reactivate* restores access. Data is not deleted.

Next: [8. Roles & permissions →](08-roles-and-permissions.md)
