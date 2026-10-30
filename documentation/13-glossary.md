# 13. Glossary — simple meanings

| Word | Simple meaning |
|------|----------------|
| **API** | The "service window" of the backend. The screens send requests to it (e.g. "give me today's appointments") and get answers back |
| **Archive** | Hide a record from everyday lists without deleting it |
| **Audit log** | A diary of who did what and when |
| **Backend** | The server part — the brain that applies rules and talks to the database |
| **Bill / Invoice** | A list of charges for a patient. Draft = still editable; Finalised = numbered and locked |
| **CSV** | A simple table file that opens in Excel |
| **Cookie** | A small secure note the browser keeps so you stay logged in |
| **CSRF** | A trick where a bad website tries to act on your behalf; the software blocks it |
| **Database** | Where all information is stored permanently (here: Microsoft SQL Server) |
| **Department** | A section of the hospital or lab (e.g. Biochemistry, Paediatrics) |
| **.env file** | The private settings file of the backend (passwords, keys). Never share it |
| **FEFO** | *First Expiry, First Out* — the pharmacy uses the batch that expires soonest first |
| **Feature / Module** | A part of the software, e.g. Laboratory or Pharmacy |
| **Flag** | Marks a lab result as normal, low, high or abnormal |
| **Frontend** | The screens you see in the browser |
| **Grace period** | Extra days after the subscription ends before it becomes read-only (default 7) |
| **IPD** | In-Patient Department — admitted patients in beds |
| **JWT** | The tamper-proof "entry pass" inside the login cookie |
| **Migration** | A numbered SQL script that creates or changes database tables; run with `npm run db:migrate` |
| **Multi-tenant** | One software and database serving many hospitals, each kept separate |
| **Node.js / npm** | The engine that runs the backend / the tool that downloads its building blocks |
| **OPD** | Out-Patient Department — consultations without admission |
| **Package (lab)** | A bundle of tests sold at one price |
| **Permission** | One specific right, e.g. "verify lab results" |
| **Plan** | Starter / Professional / Enterprise — decides which modules a hospital gets |
| **Price history** | The timeline of every price a test or package has had, with reasons |
| **Receipt** | Proof of a payment (`RCT-…`); a refund has `RFD-…` |
| **Referral doctor** | An outside doctor who sends patients to the lab, possibly for a commission |
| **Role** | A named group of permissions, e.g. Receptionist |
| **Sample** | The specimen (blood, urine…) collected for tests; one per sample type per order |
| **Sandbox** | A practice payment screen for testing — no real money |
| **SaaS** | Software as a Service — rented and used online instead of installed |
| **Seed** | Filling the database with starting data (`npm run db:seed`) |
| **Super Admin** | The platform owner who manages all hospitals, plans and payments |
| **Tenant / TenantId** | One hospital in the system / the hidden number stamped on all its data |
| **Toast** | The small pop-up message in the corner confirming an action |
| **Turnaround time (TAT)** | Time from lab order to verified report |
| **Verify (lab)** | Final check by a senior; locks the results |
| **Webhook** | A message the payment company sends straight to our server to confirm a payment |
| **Workspace** | A hospital's short name in the system, e.g. `green-valley`, used on the login page and in its web address |

Next: [14. For developers →](14-for-developers.md)
