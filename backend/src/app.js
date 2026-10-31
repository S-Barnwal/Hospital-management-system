import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { config } from './config/env.js';
import { db } from './db/pool.js';
import { resolveHostTenant } from './middleware/auth.js';
import { csrfGuard } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './modules/auth/auth.routes.js';
import publicRoutes from './modules/public/public.routes.js';
import geoRoutes from './modules/geo/geo.routes.js';
import attachmentRoutes from './modules/attachments/attachments.routes.js';
import ipdCareRoutes from './modules/ipd/care.routes.js';
import cashRoutes from './modules/billing/cash.routes.js';
import payLinkRoutes from './modules/billing/payLink.public.routes.js';
import invoiceRoutes from './modules/invoices/invoices.routes.js';
import onboardingRoutes, { webhookHandler } from './modules/onboarding/onboarding.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import queueRoutes from './modules/queue/queue.routes.js';
import displayRoutes from './modules/queue/display.public.routes.js';
import bookingRoutes from './modules/booking/booking.routes.js';
import bookingPublicRoutes from './modules/booking/booking.public.routes.js';
import supportRoutes from './modules/support/support.routes.js';
import branchRoutes from './modules/branches/branches.routes.js';
import { countRequest } from './utils/metrics.js';
import tenantRoutes from './modules/tenant/tenant.routes.js';
import dashboardRoutes from './modules/dashboard/dashboard.routes.js';
import patientRoutes from './modules/patients/patients.routes.js';
import appointmentRoutes from './modules/appointments/appointments.routes.js';
import staffRoutes from './modules/staff/staff.routes.js';
import userRoutes from './modules/users/users.routes.js';
import opdRoutes from './modules/opd/opd.routes.js';
import ipdRoutes from './modules/ipd/ipd.routes.js';
import billingRoutes from './modules/billing/billing.routes.js';
import labRoutes from './modules/lab/lab.routes.js';
import pharmacyRoutes from './modules/pharmacy/pharmacy.routes.js';
import reportRoutes from './modules/reports/reports.routes.js';
import expenseRoutes from './modules/expenses/expenses.routes.js';
import analyticsRoutes from './modules/analytics/analytics.routes.js';
import backupRoutes from './modules/backups/backups.routes.js';
import reportShareRoutes from './modules/lab/reportShare.routes.js';
import messagingSettingsRoutes from './modules/tenant/messagingSettings.routes.js';

/** Allows the configured origins plus any tenant subdomain of APP_BASE_DOMAIN over https (or http on localhost). */
export function makeOriginCheck(cfg) {
  const base = cfg.appBaseDomain;
  return (origin) => {
    if (!origin) return true;
    if (cfg.corsOrigins.includes(origin)) return true;
    try {
      const u = new URL(origin);
      const hostOk = u.hostname === base || u.hostname.endsWith(`.${base}`);
      const protoOk = u.protocol === 'https:' || (!cfg.isProd && u.protocol === 'http:');
      return hostOk && protoOk;
    } catch {
      return false;
    }
  };
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use((req, res, next) => {
    req.id = randomUUID();
    res.set('X-Request-Id', req.id);
    const started = Date.now();
    res.on('finish', () => {
      // Structured access log. Never logs bodies (they may hold patient data or passwords).
      console.log(JSON.stringify({ level: 'info', requestId: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started }));
      countRequest(res.statusCode);
    });
    next();
  });

  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, // API serves JSON only
    crossOriginResourcePolicy: { policy: 'same-site' },
  }));

  const isAllowedOrigin = makeOriginCheck(config);
  app.use(cors({
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Requested-With'],
    maxAge: 600,
  }));

  // Webhooks need the raw body for signature verification — mount BEFORE express.json().
  app.post('/api/v1/billing/webhooks/:provider', express.raw({ type: 'application/json', limit: '256kb' }), webhookHandler);

  // File uploads arrive as raw bytes (≤ 5 MB) — parsed only on this one route, before the JSON parser.
  app.post('/api/v1/attachments', express.raw({ type: () => true, limit: '5mb' }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use(resolveHostTenant);
  app.use('/api', csrfGuard({ allowedOrigins: config.corsOrigins, isAllowedOrigin, exemptPaths: ['/v1/billing/webhooks/'] }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  app.get('/api/health', async (_req, res) => {
    try {
      await db.one('SELECT 1 AS ok');
      res.json({ status: 'ok', db: 'ok', time: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({ status: 'degraded', db: 'unreachable', ...(config.isProd ? {} : { reason: `${err.code || ''} ${err.message}` }), time: new Date().toISOString() });
    }
  });

  const v1 = express.Router();
  v1.use('/auth', authRoutes);
  v1.use('/onboarding', onboardingRoutes);
  v1.use('/admin/invoices', invoiceRoutes);
  v1.use('/admin', adminRoutes);
  v1.use('/dashboard', dashboardRoutes);
  v1.use('/patients', patientRoutes);
  v1.use('/appointments', appointmentRoutes);
  v1.use('/hr', staffRoutes);
  v1.use('/users', userRoutes);
  v1.use('/opd', opdRoutes);
  v1.use('/ipd', ipdRoutes);
  v1.use('/ipd', ipdCareRoutes);
  v1.use('/billing', billingRoutes);
  v1.use('/billing', cashRoutes);
  v1.use('/public/pay', payLinkRoutes);
  v1.use('/lab', labRoutes);
  v1.use('/pharmacy', pharmacyRoutes);
  v1.use('/reports', reportRoutes);
  v1.use('/expenses', expenseRoutes);
  v1.use('/analytics', analyticsRoutes);
  v1.use('/backups', backupRoutes);
  v1.use('/public/reports', reportShareRoutes);
  v1.use('/settings/messaging', messagingSettingsRoutes);
  v1.use('/geo', geoRoutes);
  v1.use('/attachments', attachmentRoutes);
  v1.use('/queue', queueRoutes);
  v1.use('/public/display', displayRoutes);
  v1.use('/booking', bookingRoutes);
  v1.use('/public/booking', bookingPublicRoutes);
  v1.use('/support', supportRoutes);
  v1.use('/branches', branchRoutes);
  v1.use('/', publicRoutes);
  v1.use('/', tenantRoutes);
  app.use('/api/v1', v1);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
