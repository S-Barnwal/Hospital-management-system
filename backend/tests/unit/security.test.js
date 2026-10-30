import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { signJwt, verifyJwt } from '../../src/utils/jwt.js';
import { evaluateTenantAccess, subscriptionState } from '../../src/middleware/tenantAccess.js';
import { csrfGuard } from '../../src/middleware/csrf.js';
import { assignmentProblem, roleEditProblem } from '../../src/modules/rbac/rbac.logic.js';
import { ROLE_TEMPLATES, ALL_CODES } from '../../src/modules/rbac/permissions.js';
import { sanitiseMetadata } from '../../src/utils/sanitise.js';
import { slugFromHost, validateSlug, normaliseSlug } from '../../src/utils/slug.js';

const SECRET = 'x'.repeat(48);

describe('JWT', () => {
  test('round-trips a valid token', () => {
    const tok = signJwt({ sub: '7', typ: 'tenant', tid: 3, sid: 's' }, SECRET, 60);
    assert.equal(verifyJwt(tok, SECRET).tid, 3);
  });
  test('rejects tampered payload (e.g. changing tenant id)', () => {
    const tok = signJwt({ sub: '7', typ: 'tenant', tid: 3 }, SECRET, 60);
    const [h, , s] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: '7', typ: 'tenant', tid: 4, exp: 9e9 })).toString('base64url');
    assert.equal(verifyJwt(`${h}.${forged}.${s}`, SECRET), null);
  });
  test('rejects expired, wrong secret and alg=none', () => {
    assert.equal(verifyJwt(signJwt({ sub: '1' }, SECRET, 10, 1000), SECRET, 2000), null);
    assert.equal(verifyJwt(signJwt({ sub: '1' }, SECRET, 60), 'y'.repeat(48)), null);
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"1","exp":9999999999}').toString('base64url')}.`;
    assert.equal(verifyJwt(none, SECRET), null);
  });
});

const baseRow = {
  SessionValid: 1, UserStatus: 'active', TenantId: 1, Slug: 'green-valley', TenantName: 'GV', TenantStatus: 'active',
  Timezone: 'Asia/Kolkata', Currency: 'INR', UserId: 10, IsOwner: false, Roles: 'receptionist', Permissions: 'patients.read,patients.write',
  SubStatus: 'active', SubPeriodEnd: new Date(Date.now() + 10 * 86400000), SubGraceDays: 7,
};
const payload = { typ: 'tenant', sub: '10', tid: 1, sid: 'abc' };
const call = (over = {}, req = {}) => evaluateTenantAccess({ payload, row: { ...baseRow, ...over }, hostSlug: null, method: 'GET', path: '/api/v1/patients', ...req });

describe('Tenant isolation decision logic', () => {
  test('context tenant comes from the session row, not the request', () => {
    const ctx = call();
    assert.equal(ctx.tenantId, 1);
    assert.ok(ctx.permissions.has('patients.write'));
  });
  test('subdomain of another hospital is refused (Hospital A user on Hospital B host)', () => {
    assert.throws(() => call({}, { hostSlug: 'blue-care' }), (e) => e.status === 403 && e.code === 'TENANT_MISMATCH');
  });
  test('matching subdomain is accepted', () => {
    assert.equal(call({}, { hostSlug: 'green-valley' }).tenantSlug, 'green-valley');
  });
  test('revoked session, disabled user and wrong token type are 401', () => {
    assert.throws(() => call({ SessionValid: 0 }), (e) => e.status === 401);
    assert.throws(() => call({ UserStatus: 'disabled' }), (e) => e.status === 401);
    assert.throws(() => evaluateTenantAccess({ payload: { ...payload, typ: 'platform' }, row: baseRow, method: 'GET', path: '/x' }), (e) => e.status === 401);
    assert.throws(() => evaluateTenantAccess({ payload, row: null, method: 'GET', path: '/x' }), (e) => e.status === 401);
  });
  test('suspended tenant: blocked except read-only account endpoints', () => {
    assert.throws(() => call({ TenantStatus: 'suspended' }), (e) => e.code === 'TENANT_SUSPENDED');
    assert.ok(call({ TenantStatus: 'suspended' }, { path: '/api/v1/tenant/me' }));
  });
  test('expired subscription is read-only, data still readable, renewal allowed', () => {
    const expired = { SubPeriodEnd: new Date(Date.now() - 30 * 86400000) };
    assert.ok(call(expired));
    assert.throws(() => call(expired, { method: 'POST' }), (e) => e.status === 402);
    assert.ok(call(expired, { method: 'POST', path: '/api/v1/subscription/renew' }));
  });
});

describe('Subscription state', () => {
  const now = new Date('2026-06-15T00:00:00Z');
  test('active / grace / expired', () => {
    assert.equal(subscriptionState({ Status: 'active', CurrentPeriodEnd: '2026-06-20T00:00:00Z', GraceDays: 7 }, now).state, 'active');
    assert.equal(subscriptionState({ Status: 'active', CurrentPeriodEnd: '2026-06-10T00:00:00Z', GraceDays: 7 }, now).state, 'grace');
    assert.equal(subscriptionState({ Status: 'active', CurrentPeriodEnd: '2026-06-01T00:00:00Z', GraceDays: 7 }, now).state, 'expired');
    assert.equal(subscriptionState(null, now).state, 'none');
  });
});

describe('CSRF guard', () => {
  const guard = csrfGuard({ allowedOrigins: ['http://localhost:5173'], exemptPaths: ['/v1/billing/webhooks/'] });
  const run = (req) => new Promise((resolve) => guard({ get: (h) => req.headers?.[h], ...req }, {}, resolve));
  test('GET passes, POST without header fails, POST with header + allowed origin passes', async () => {
    assert.equal(await run({ method: 'GET', path: '/x' }), undefined);
    assert.equal((await run({ method: 'POST', path: '/x', headers: {} })).code, 'CSRF');
    assert.equal(await run({ method: 'POST', path: '/x', headers: { 'x-requested-with': 'fetch', origin: 'http://localhost:5173' } }), undefined);
    assert.equal((await run({ method: 'POST', path: '/x', headers: { 'x-requested-with': 'fetch', origin: 'https://evil.example' } })).code, 'CSRF');
    assert.equal(await run({ method: 'POST', path: '/v1/billing/webhooks/razorpay', headers: {} }), undefined);
  });
});

describe('RBAC escalation rules', () => {
  const perms = (code) => new Set(ROLE_TEMPLATES.find((r) => r.code === code).permissions);
  const admin = { userId: 1, isOwner: false, permissions: perms('hospital_admin'), roles: ['hospital_admin'] };
  const role = (code) => ({ code, name: code, permissions: ROLE_TEMPLATES.find((r) => r.code === code).permissions });
  test('cannot change own roles', () => {
    assert.match(assignmentProblem({ actor: admin, targetUserId: 1, roles: [role('receptionist')] }), /own roles/);
  });
  test('admin can grant receptionist, but not owner', () => {
    assert.equal(assignmentProblem({ actor: admin, targetUserId: 2, roles: [role('receptionist')] }), null);
    assert.match(assignmentProblem({ actor: admin, targetUserId: 2, roles: [role('owner')] }), /Owner/);
  });
  test('receptionist cannot grant a role containing permissions they lack', () => {
    const recep = { userId: 5, isOwner: false, permissions: perms('receptionist'), roles: ['receptionist'] };
    assert.match(assignmentProblem({ actor: recep, targetUserId: 6, roles: [role('accountant')] }), /do not hold/);
  });
  test('role editing: owner role locked, own role locked, cannot add unheld perms', () => {
    assert.match(roleEditProblem({ actor: admin, role: { code: 'owner' }, newPerms: [] }), /Owner/);
    assert.match(roleEditProblem({ actor: admin, role: { code: 'hospital_admin' }, newPerms: [] }), /hold yourself/);
    assert.match(roleEditProblem({ actor: admin, role: { code: 'doctor' }, newPerms: ['subscription.manage'] }), /do not hold/);
    assert.equal(roleEditProblem({ actor: admin, role: { code: 'doctor' }, newPerms: ['patients.read'] }), null);
  });
  test('owner template holds every permission; hospital_admin lacks subscription.manage', () => {
    assert.equal(perms('owner').size, ALL_CODES.length);
    assert.equal(perms('hospital_admin').has('subscription.manage'), false);
  });
});

describe('Audit metadata sanitising', () => {
  test('drops secrets and clinical fields', () => {
    const out = JSON.parse(sanitiseMetadata({ password: 'x', refreshToken: 'y', diagnosis: 'z', notes: 'n', slug: 'ok' }));
    assert.deepEqual(out, { slug: 'ok' });
  });
});

describe('Slugs & host resolution', () => {
  test('subdomain → slug', () => {
    assert.equal(slugFromHost('green-valley.app.example.com', 'app.example.com'), 'green-valley');
    assert.equal(slugFromHost('app.example.com', 'app.example.com'), null);
    assert.equal(slugFromHost('admin.app.example.com', 'app.example.com'), null);
    assert.equal(slugFromHost('a.b.app.example.com', 'app.example.com'), null);
    assert.equal(slugFromHost('evil.com', 'app.example.com'), null);
    assert.equal(slugFromHost('blue-care.localhost:5173', 'localhost'), 'blue-care');
  });
  test('validation & normalisation', () => {
    assert.equal(normaliseSlug('  Green Valley Hospital!! '), 'green-valley-hospital');
    assert.equal(validateSlug('green-valley'), null);
    assert.ok(validateSlug('admin'));
    assert.ok(validateSlug('-bad'));
    assert.ok(validateSlug('ab'));
  });
});

describe('Friendly validation messages', async () => {
  const { z } = await import('zod');
  const { friendlyMessage } = await import('../../src/middleware/validate.js');
  const msgs = (schema, value) => schema.safeParse(value).error.issues.map(friendlyMessage);
  test('replaces zod defaults with plain language', () => {
    const s = z.object({ password: z.string().min(1), email: z.string().email(), name: z.string().min(3), type: z.enum(['a', 'b']), n: z.number().max(5) }).strict();
    const m = msgs(s, { password: '', email: 'x', name: 'ab', type: 'c', n: 9 });
    assert.deepEqual(m, ['This field is required.', 'Enter a valid e-mail address, e.g. name@hospital.com.', 'Enter at least 3 characters.', 'Please choose one of the options.', 'Must be 5 or less.']);
    assert.deepEqual(msgs(z.object({ a: z.string() }), {}), ['This field is required.']);
  });
  test('keeps messages written in the schema', () => {
    assert.deepEqual(msgs(z.string().regex(/^\d+$/, 'Enter a valid phone number'), 'x'), ['Enter a valid phone number']);
  });
});
