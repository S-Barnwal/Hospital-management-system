# 15. E-mail & WhatsApp — setup and what gets sent

MediCore sends a few messages automatically. Until you connect real providers, it runs in **test ("log") mode**: nothing is delivered, the message is written to the backend terminal and shown as **logged** in *Administration → Message log*. Everything else works normally, so you can try the features safely.

## Whose name is on the message? (one account, many hospitals)

The platform has **one** e-mail account and **one** WhatsApp number (set in `backend/.env`), shared by all hospitals. Every message still looks like it comes from the hospital:

```
From:     "Green Valley Hospital" <no-reply@medicore.in>     ← hospital's name, platform's address
Reply-To: info@greenvalley.in                                 ← hospital's own e-mail
```

- The **sender name** is the hospital's name (Settings → Hospital name).
- **Replies** go to the hospital: *Settings → Messages to patients → Reply-to e-mail*, or the hospital e-mail if that is empty.
- WhatsApp texts always name the hospital inside the message.
- Hospitals need **no setup**. *Settings → Messages to patients* shows exactly what patients see and has a **Send test** button.

### Optional: a hospital's own e-mail / WhatsApp (Enterprise plan)

On the Enterprise plan a hospital can connect its **own SMTP server** (e.g. `reports@yourhospital.com`) and/or its **own WhatsApp Business number** under *Settings → Messages to patients → Use your own…*. Then its messages go through its account; if it is switched off or broken, the platform account is used automatically.

- Passwords and tokens are **encrypted** (AES-256-GCM) with the server key `MESSAGING_ENCRYPTION_KEY` and are never shown again — the screen only says "saved".
- For safety the server refuses SMTP servers on internal/private network addresses and only allows ports 25, 465, 587 and 2525.
- The Message log shows whether each message went via the platform or the hospital's own account.
- To offer this, the platform admin sets `MESSAGING_ENCRYPTION_KEY` once (see `.env.example`). Keep that key safe: if it is lost, hospitals must re-enter their passwords.

## What is sent, to whom, and when

| Message | Channel | To | When | Can be switched off |
|---------|---------|----|------|---------------------|
| Password reset link | E-mail | The staff member | *Forgot password* | — |
| 2-step sign-in code | E-mail | Owner / Hospital Admin (and Super Admin if enabled) | At sign-in | Settings → *2-step sign-in* |
| Appointment confirmation | WhatsApp, else e-mail* | Patient | Right after booking | Settings → *Appointment messages to patients* |
| Appointment reminder | WhatsApp, else e-mail* | Patient | ~1 day before (12–36 h) | Settings → *Appointment messages to patients* |
| Lab report link | WhatsApp or e-mail | Patient | When staff click *Send on WhatsApp / Send by e-mail* on a verified order | — (manual) |
| Report one-time code | Same channel as the link | Patient | When the patient opens the link | — |
| Subscription reminder | E-mail | Owner + hospital e-mail | 7, 3 and 1 day before the end date, and on the day it ends | — |
| Daily summary | E-mail | Owner(s) | Every evening after 8 pm (hospital time) | Settings → *Daily summary* |
| Follow-up reminder | E-mail, else WhatsApp | Patient | The day before the follow-up date (after 9 am) — skipped if already booked/visited | Settings → *Follow-up reminders* |
| Bill payment link | WhatsApp or e-mail | Patient | When staff click *Send* in a bill's *Payment link* | — (manual) |

\* WhatsApp is used when it is set up and the patient has a mobile number; otherwise the message goes by e-mail if the patient has an e-mail address. Each appointment gets at most one confirmation and one reminder.

Scheduled messages are checked every 5 minutes and each is sent **at most once**, even if the server restarts or you run several servers.

## Privacy rules built in

- The Message log stores **masked** recipients (e.g. `91******3210`) — it is not a list of patient phone numbers.
- Report links are **random, expire after 7 days, can be revoked**, and only open after a one-time code sent to the patient. The report itself is never attached to the message.
- In production, message **bodies** (codes, links) are never written to the server log.

## Set up e-mail (SMTP)

Any e-mail service with SMTP works (Google Workspace, Zoho Mail, Microsoft 365, Amazon SES, Brevo…). In `backend/.env`:

```ini
EMAIL_PROVIDER=smtp
EMAIL_FROM="Green Valley Hospital <no-reply@yourdomain.com>"
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password-or-app-password
```

Then `npm install` (adds the `nodemailer` library) and restart the backend. Test with *Forgot password* — the Message log should show **sent**.

> For Gmail/Google Workspace use an **App password**, not your normal password. Set up SPF/DKIM for your domain so mails don't land in spam.

## Set up WhatsApp (Meta WhatsApp Cloud API)

1. Create a Meta Business account and a WhatsApp Business app at developers.facebook.com → add the **WhatsApp** product.
2. Add and verify your hospital's business phone number. Note the **Phone number ID** and create a **permanent access token** (System User).
3. Create these **message templates** (Business Manager → WhatsApp → Message templates) with exactly these names and body variables:

| Template name | Category | Body example (variables in order) |
|---------------|----------|-----------------------------------|
| `appointment_confirmed` | Utility | Dear {{1}}, your appointment with {{2}} on {{3}} at {{4}} is confirmed. Ref: {{5}} |
| `appointment_reminder` | Utility | Reminder: {{1}}, you have an appointment with {{2}} on {{3}} at {{4}}. Ref: {{5}} |
| `lab_report_ready` | Utility | Dear {{1}}, your lab report from {{2}} is ready. Open securely: {{3}} |
| `report_otp` | Authentication | {{1}} is your code to open your lab report from {{2}}. |
| `follow_up_reminder` | Utility | Dear {{1}}, {{2}} asked to see you again on {{3}} at {{4}}. Please call to book your visit. |
| `bill_payment_link` | Utility | Dear {{1}}, your bill {{3}} from {{2}} has ₹{{4}} due. Pay securely by UPI: {{5}} |

4. In `backend/.env`:

```ini
WHATSAPP_PROVIDER=meta
WHATSAPP_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=1234567890
WHATSAPP_TEMPLATE_LANGUAGE=en
DEFAULT_COUNTRY_CODE=91
```

5. Restart the backend and book a test appointment for a patient with your own mobile number.

Patients' mobile numbers can be typed in any format (`98765 43210`, `+91-98765-43210`); 10-digit numbers get the country code automatically.

## Troubleshooting

| Message log shows | Meaning | Fix |
|-------------------|---------|-----|
| **logged** | Test mode | Configure the provider as above |
| **failed** + error | The provider refused | Read the error (wrong password, template not approved, number not on WhatsApp…) |
| **skipped** "No valid mobile number / e-mail" | Patient record has no usable contact | Add it on the patient's page |
| **skipped** "Already sent" | Duplicate prevented | Nothing to do |

[← Back to the documentation index](README.md)
