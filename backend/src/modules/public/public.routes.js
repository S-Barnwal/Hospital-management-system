import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/errors.js';
import { db } from '../../db/pool.js';
import { audit } from '../../utils/audit.js';
import { quote } from '../../utils/pricing.js';
import { FACILITY_TYPES } from '../../utils/constants.js';

const router = Router();
const formLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many submissions. Please try again later.' } },
});

export function serialisePlan(p, features) {
  const priced = !p.IsContactSales;
  return {
    code: p.Code,
    name: p.Name,
    tagline: p.Tagline,
    description: p.Description,
    currency: p.Currency,
    taxRatePercent: Number(p.TaxRatePercent),
    contactSales: Boolean(p.IsContactSales),
    popular: Boolean(p.IsPopular),
    monthly: priced ? quote(p, 'monthly') : null,
    annual: priced ? quote(p, 'annual') : null,
    limits: { staffUsers: p.MaxStaffUsers, branches: p.MaxBranches, patients: p.MaxPatients },
    features: features.filter((f) => f.PlanId === p.PlanId).map((f) => ({ key: f.FeatureKey, label: f.Label, included: Boolean(f.IsIncluded) })),
  };
}

router.get('/plans', asyncHandler(async (_req, res) => {
  const [plans, features] = await db.many(`
    SELECT * FROM hms.Plans WHERE IsActive = 1 ORDER BY SortOrder, PlanId;
    SELECT pf.PlanId, pf.FeatureKey, pf.Label, pf.IsIncluded FROM hms.PlanFeatures pf
      JOIN hms.Plans p ON p.PlanId = pf.PlanId AND p.IsActive = 1 ORDER BY pf.SortOrder;`);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ data: plans.map((p) => serialisePlan(p, features)) });
}));

router.get('/site-settings', asyncHandler(async (_req, res) => {
  const rows = await db.query(`SELECT SettingKey, SettingValue FROM hms.PlatformSettings WHERE SettingKey LIKE 'contact.%' OR SettingKey LIKE 'brand.%'`);
  res.json({ data: Object.fromEntries(rows.map((r) => [r.SettingKey, r.SettingValue])) });
}));

const phone = z.string().trim().regex(/^[+\d][\d\s-]{6,19}$/, 'Enter a valid phone number');
const honeypot = z.string().max(0, 'Spam detected').optional(); // hidden "website" field must stay empty

const demoSchema = z.object({
  orgName: z.string().trim().min(2).max(200),
  contactName: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email().max(254),
  phone,
  city: z.string().trim().max(100).optional(),
  facilityType: z.enum(FACILITY_TYPES).optional(),
  expectedUsers: z.coerce.number().int().min(1).max(100000).optional(),
  preferredAt: z.string().datetime({ offset: true }).optional()
    .refine((v) => !v || new Date(v) > new Date(), 'Preferred time must be in the future'),
  message: z.string().trim().max(2000).optional(),
  website: honeypot,
}).strict();

router.post('/demo-requests', formLimiter, validate(demoSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const row = await db.one(
    `INSERT INTO hms.DemoRequests (OrgName, ContactName, Email, Phone, City, FacilityType, ExpectedUsers, PreferredAt, Message, SourceIp)
     OUTPUT INSERTED.DemoRequestId
     VALUES (@org, @name, @email, @phone, @city, @ftype, @users, @pref, @msg, @ip)`,
    { org: b.orgName, name: b.contactName, email: b.email, phone: b.phone, city: b.city ?? null, ftype: b.facilityType ?? null,
      users: b.expectedUsers ?? null, pref: b.preferredAt ? new Date(b.preferredAt) : null, msg: b.message ?? null, ip: req.ip });
  await audit({ actorType: 'public', action: 'demo_request.created', entityType: 'demo_request', entityId: row.DemoRequestId, ip: req.ip });
  res.status(201).json({ data: { id: row.DemoRequestId, message: 'Thank you! Our team will contact you within one business day.' } });
}));

const contactSchema = z.object({
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: phone.optional().or(z.literal('').transform(() => undefined)),
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().min(10).max(4000),
  website: honeypot,
}).strict();

router.post('/contact', formLimiter, validate(contactSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  await db.exec(
    `INSERT INTO hms.ContactMessages (Name, Email, Phone, Subject, Message, SourceIp) VALUES (@n, @e, @p, @s, @m, @ip)`,
    { n: b.name, e: b.email, p: b.phone ?? null, s: b.subject ?? null, m: b.message, ip: req.ip });
  res.status(201).json({ data: { message: 'Thanks for reaching out. We will reply by e-mail.' } });
}));

export default router;
