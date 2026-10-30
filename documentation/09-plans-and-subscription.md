# 9. Plans, subscription & renewal

## Default plans

Prices are set by the Super Admin and can be changed any time under *Admin → Plans*. The defaults are:

| | **Starter** | **Professional** ⭐ | **Enterprise** |
|---|---|---|---|
| For | Clinics, single-doctor practices | Growing clinics, small hospitals | Multi-speciality / multi-branch |
| Monthly | ₹999 + GST | ₹2,999 + GST | Contact sales |
| Yearly | ₹9,990 + GST | ₹29,990 + GST | Contact sales |
| Staff users | 5 | 20 | Custom |
| Patients, appointments, staff, roles & audit, OPD | ✓ | ✓ | ✓ |
| Billing, payments, expenses | — | ✓ | ✓ |
| IPD, wards & beds | — | ✓ | ✓ |
| Laboratory (orders, samples, packages, referral doctors) | — | ✓ | ✓ |
| Pharmacy & inventory | — | ✓ | ✓ |
| Reports, analytics & CSV export | — | ✓ | ✓ |
| Backups (data download) | ✓ | ✓ | ✓ |
| Multi-branch management | — | — | ✓ (planned) |
| Priority support | — | — | ✓ |

Tax (GST 18% by default) is added at checkout and shown on the invoice.

## Buying

Pricing → *Get started* → Register (hospital + owner details + workspace name) → Pay → workspace created. See [chapter 2](02-how-it-works.md).

## Life of a subscription

| State | What the hospital sees | What it can do |
|-------|------------------------|----------------|
| **Active** | Normal | Everything in the plan |
| **Grace** (end date passed, within grace days — default 7) | Yellow banner "x day(s) of grace left" | Everything, but should renew |
| **Expired** | Red banner "Subscription expired. Your data is safe but read-only." | **View** everything and **download backups**; cannot add or change anything |

**Data is never deleted** because of non-payment.

## Renewing or changing plan

Owner → **Subscription** → choose plan and monthly/annual → **Renew** → pay. The new period starts from the old end date (if renewing early) so no days are lost.

## Real online payments (Razorpay)

Locally the software uses a **sandbox** (practice) payment screen. For real money:

1. Log in to the Razorpay Dashboard → *Account & Settings → API Keys* → generate keys (start with **Test mode**, keys begin with `rzp_test_`).
2. In `backend/.env` set:
   ```ini
   PAYMENT_PROVIDER=razorpay
   RAZORPAY_KEY_ID=rzp_test_xxxxx
   RAZORPAY_KEY_SECRET=xxxxx
   ```
3. In Razorpay → *Webhooks*, add `https://<your-api-domain>/api/v1/billing/webhooks/razorpay` for events `payment.captured`, `order.paid`, `payment.failed`, and copy its secret into `RAZORPAY_WEBHOOK_SECRET`.
4. Test end-to-end, then switch to **Live** keys.

> The Razorpay **Account ID** (`acc_…`) and **Merchant ID** are *not* API keys — the software needs the Key ID and Key Secret.

**Why payments can't be faked:** the server confirms every payment with Razorpay using a secret signature, and the webhook (a message sent by Razorpay directly to our server) is also signature-checked. The same payment can never create two hospitals or two renewals.

Next: [10. Security & privacy →](10-security-and-privacy.md)
