import { parseKey } from '../utils/secretBox.js';
// Centralised, validated environment configuration.
// Values come from process.env (loaded from backend/.env by `node --env-file`).

function bool(v, fallback = false) {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function int(v, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parses an ADO.NET-style SQL Server connection string, e.g.
 * "Data Source=host;Initial Catalog=db;User Id=u;Password=p;Encrypt=True;TrustServerCertificate=True;"
 * into an mssql/tedious config object.
 */
export function parseConnectionString(cs) {
  const out = {};
  for (const part of String(cs).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim().toLowerCase().replace(/\s+/g, ' ');
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  const rawServer = out['data source'] || out.server || out.address || out.addr || '';
  let server = rawServer.replace(/^tcp:/i, '');
  let port;
  const comma = server.indexOf(',');
  if (comma !== -1) {
    port = int(server.slice(comma + 1), undefined);
    server = server.slice(0, comma);
  }
  let instanceName;
  const slash = server.indexOf('\\');
  if (slash !== -1) {
    instanceName = server.slice(slash + 1);
    server = server.slice(0, slash);
  }
  return {
    server,
    port,
    database: out['initial catalog'] || out.database,
    user: out['user id'] || out.uid || out.user,
    password: out.password || out.pwd,
    options: {
      encrypt: bool(out.encrypt, true),
      trustServerCertificate: bool(out.trustservercertificate ?? out['trust server certificate'], false),
      ...(instanceName ? { instanceName } : {}),
    },
  };
}

function buildDbConfig(env) {
  const base = env.DB_CONNECTION_STRING
    ? parseConnectionString(env.DB_CONNECTION_STRING)
    : {
        server: env.DB_SERVER,
        port: int(env.DB_PORT, undefined),
        database: env.DB_NAME,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        options: {
          encrypt: bool(env.DB_ENCRYPT, true),
          trustServerCertificate: bool(env.DB_TRUST_SERVER_CERT, false),
        },
      };
  return {
    ...base,
    pool: { max: int(env.DB_POOL_MAX, 10), min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: int(env.DB_CONNECT_TIMEOUT_MS, 30000),
    requestTimeout: 30000,
    options: { ...base.options, enableArithAbort: true, useUTC: true },
  };
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';
  const cfg = {
    nodeEnv,
    isProd,
    port: int(env.PORT, 5000),
    // Base domain used for tenant subdomains: <slug>.<APP_BASE_DOMAIN>
    appBaseDomain: (env.APP_BASE_DOMAIN || 'localhost').toLowerCase(),
    publicAppUrl: env.PUBLIC_APP_URL || 'http://localhost:5173',
    corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: int(env.TRUST_PROXY, 0),
    jwtSecret: env.JWT_SECRET || '',
    accessTokenTtlSec: int(env.ACCESS_TOKEN_TTL_SEC, 15 * 60),
    refreshTokenTtlDays: int(env.REFRESH_TOKEN_TTL_DAYS, 7),
    cookieSecure: bool(env.COOKIE_SECURE, isProd),
    cookieDomain: env.COOKIE_DOMAIN || undefined,
    db: buildDbConfig(env),
    payments: {
      provider: (env.PAYMENT_PROVIDER || 'sandbox').toLowerCase(),
      razorpay: {
        keyId: env.RAZORPAY_KEY_ID || '',
        keySecret: env.RAZORPAY_KEY_SECRET || '',
        webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
      },
      sandboxSecret: env.SANDBOX_PAYMENT_SECRET || 'local-sandbox-only-secret',
    },
    subscriptionGraceDays: int(env.SUBSCRIPTION_GRACE_DAYS, 7),
    // Outgoing messages. "log" = do not send; print to the server log and the Message log (development).
    email: {
      provider: (env.EMAIL_PROVIDER || 'log').toLowerCase(), // log | smtp
      from: env.EMAIL_FROM || 'MediCore HMS <no-reply@localhost>',
      smtp: {
        host: env.SMTP_HOST || '', port: int(env.SMTP_PORT, 587), secure: bool(env.SMTP_SECURE, false),
        user: env.SMTP_USER || '', pass: env.SMTP_PASS || '',
      },
    },
    whatsapp: {
      provider: (env.WHATSAPP_PROVIDER || 'log').toLowerCase(), // log | meta
      token: env.WHATSAPP_TOKEN || '',
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
      language: env.WHATSAPP_TEMPLATE_LANGUAGE || 'en',
      defaultCountryCode: env.DEFAULT_COUNTRY_CODE || '91',
    },
    jobs: { enabled: bool(env.JOBS_ENABLED, true), intervalSec: int(env.JOBS_INTERVAL_SEC, 300) },
    superAdminMfa: bool(env.SUPERADMIN_MFA, false),
    // 32 random bytes (base64). Needed only if hospitals connect their OWN e-mail/WhatsApp (Enterprise).
    messagingKey: parseKey(env.MESSAGING_ENCRYPTION_KEY),
    superAdmin: {
      email: env.SUPERADMIN_EMAIL || '',
      password: env.SUPERADMIN_PASSWORD || '',
      name: env.SUPERADMIN_NAME || 'Platform Admin',
    },
  };

  const problems = [];
  if (!cfg.jwtSecret || cfg.jwtSecret.length < 32) problems.push('JWT_SECRET must be set (32+ random characters).');
  if (isProd && cfg.payments.provider === 'sandbox') problems.push('PAYMENT_PROVIDER=sandbox is not allowed in production.');
  if (cfg.payments.provider === 'razorpay' && (!cfg.payments.razorpay.keyId || !cfg.payments.razorpay.keySecret)) {
    problems.push('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required when PAYMENT_PROVIDER=razorpay.');
  }
  if (cfg.email.provider === 'smtp' && !cfg.email.smtp.host) problems.push('SMTP_HOST is required when EMAIL_PROVIDER=smtp.');
  if (cfg.whatsapp.provider === 'meta' && (!cfg.whatsapp.token || !cfg.whatsapp.phoneNumberId)) {
    problems.push('WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required when WHATSAPP_PROVIDER=meta.');
  }
  if (cfg.superAdminMfa && cfg.email.provider === 'log' && isProd) problems.push('SUPERADMIN_MFA needs a real EMAIL_PROVIDER in production.');
  if (env.MESSAGING_ENCRYPTION_KEY && !cfg.messagingKey) problems.push('MESSAGING_ENCRYPTION_KEY must be 32 random bytes in base64 (44 characters).');
  cfg.problems = problems;
  return cfg;
}

export const config = loadConfig();
