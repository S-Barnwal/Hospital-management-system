# 7. Super Admin (platform owner) guide

The **Super Admin portal** is for the company that sells MediCore (not for hospitals). Log in at **`/admin/login`** with the e-mail and password set in `backend/.env` (`SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`) and created by `npm run db:seed`.

> The Super Admin login and the hospital login are separate systems with separate cookies and a separate user table. Trying the admin password on `/login` will fail — that is by design. There is a link to the admin portal under the hospital login form.

## Menu

| Screen | What you can do |
|--------|-----------------|
| **Overview** | Number of hospitals, active subscriptions, revenue, new demo requests, recent sign-ups |
| **Hospitals (tenants)** | List every hospital; open one to see its plan, subscription dates, owner contact, usage counts; **suspend** or **reactivate** a hospital |
| **Plans** | Create/edit plans: name, monthly & annual price, tax %, user limits, which modules are included, "popular" badge, "contact sales" plans; delete unused plans; **Make free / Start charging** ("free for now" mode — see below) |
| **Subscriptions** | All subscriptions with status (active / grace / expired) and end dates |
| **Payments** | All subscription payments received from hospitals (sandbox test payments are clearly labelled) |
| **Invoices** | Every invoice issued to hospitals — automatic for paid and free plans, plus manual ones. View, **Download PDF**, **Export CSV** (for your CA / GST return), create, edit, issue, void |
| **Hospital map** | Map of every hospital that has placed its pin, with a searchable list (city, state, PIN) |
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

**Invoices**

*Automatic:* when a hospital pays (sign-up or renewal) an invoice is issued with exactly the amount charged; when it joins or renews on a **free** plan a **₹0 invoice** is issued (list price shown, 100% promotional discount). Numbers run per financial year: `INV/2627/000001`. Test payments from the sandbox gateway get their own series `SBX/2627/…` and are hidden from the list unless you choose *Sandbox (test) only*.

*Seller details:* fill **Website settings → Invoices (seller details)** once — legal name, **GSTIN**, state of GST registration and default **SAC** (997331 is common for software subscriptions; confirm with your CA). With a GSTIN the invoice is titled **Tax Invoice** and shows **CGST + SGST** when the hospital is in the same state, otherwise **IGST**. Each invoice keeps the seller and buyer details it was issued with.

*Manual invoice:* Invoices → **New invoice** → choose the hospital, description, rate, quantity, discount and GST rate (the total is shown as you type). **Save as draft** (can be changed or deleted) or **Issue invoice** (gets the next number).

*Editing:* open an invoice → **Edit** and type a reason.
- Draft: everything can be changed.
- Issued: buyer details (name, address, GSTIN…), notes, due date and payment reference can be corrected; **amounts are locked**.
- To change an amount on an issued invoice: **Void** it (with a reason) and create a new one. A void invoice stays in the register stamped **VOID**; its number is never reused. Issued invoices are never deleted — this is what auditors and GST rules expect.

*Seller details changed after an invoice was issued?* Each invoice keeps the company details it was issued with (that is how an official copy should behave). If you filled or corrected Website settings later, open the invoice → **Update seller details** → give a reason. The current name, address, e-mail, phone, GSTIN and state are copied onto it; number and amounts stay the same, the old details stay in the Audit log. Invoices issued from now on use the new details automatically.

*State:* if you leave "State of GST registration" empty it is taken from the GSTIN (first two digits — 09 = Uttar Pradesh, 27 = Maharashtra…). A state that contradicts the GSTIN is refused.

Every create, edit (with the old values), issue, void and export is written to the **Audit logs**.

**Change prices**
Plans → edit → change monthly/annual price. Existing subscriptions keep their paid period; new prices apply on next purchase/renewal.

**A hospital didn't pay**
Nothing to do manually. After the end date it gets *grace days* (default 7), then becomes *read-only*. Their data is kept safely. When they renew, everything unlocks.

**Give the software free for a while ("Free for now" mode)**

Useful at launch, or for a festival offer.

1. Plans → **Make all plans free** (or **Make free** on one plan) → confirm.
2. At once the public website shows a gold strip: *"Hurray! All plans are FREE for now — register your hospital…"*; the Pricing page shows **Free** with the normal price struck through; the Register page says *"No payment needed"* and its button becomes **Create my free workspace**.
3. A hospital that registers now gets its **own, separate workspace immediately** — exactly the same as a paid sign-up (own data, own roles, own numbering like `LAB-000001`), and the owner lands straight on the dashboard. Nothing is charged and no invoice is made.
4. Limits that stop misuse: one free workspace per owner e-mail; the normal per-device sign-up limit applies; *Contact sales* plans cannot be made free.
5. While the plan stays free, those hospitals **never expire** and get no "please renew" e-mails.

**Start charging again**

1. Plans → **Start charging** (one plan or all) → enter a **notice period** (default 7 days, 0–90) → confirm.
2. The website banner disappears and new sign-ups must pay again.
3. Every hospital that joined free keeps working until the notice period ends (or its current end date, if sooner), receives the normal reminder e-mails (7/3/1/0 days), then gets the usual grace days, and after that becomes read-only until the owner pays from **Subscription**. **No data is ever deleted.**
4. The audit log records who switched and how many hospitals were moved to paid.

> **Active / Hidden** is a different switch: *Hidden* removes a plan from the website completely. *Free* keeps it on the website but at ₹0.

**Suspend a hospital** (e.g. abuse, legal request)
Hospitals → open → *Suspend* (a reason is required). Its users can no longer log in. *Reactivate* restores access. Data is not deleted.

Next: [8. Roles & permissions →](08-roles-and-permissions.md)
