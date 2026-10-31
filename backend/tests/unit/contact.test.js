import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { parsePhone, phoneSchema, optionalPhone, isValidEmail, emailSchema, optionalEmail, withLocation } from '../../src/utils/contact.js';
import { loadGeo, flagOf, timezoneFor } from '../../src/utils/geo.js';

describe('Phone numbers', () => {
  test('Indian numbers in any format become E.164', () => {
    for (const raw of ['9876543210', '+91 98765 43210', '098765-43210', '+91-9876543210', '(+91) 98765 43210']) {
      assert.equal(parsePhone(raw)?.e164, '+919876543210', raw);
    }
  });
  test('other countries need their own country code and correct length', () => {
    assert.equal(parsePhone('+1 650 253 0000')?.e164, '+16502530000');
    assert.equal(parsePhone('+44 20 7031 3000')?.e164, '+442070313000');
    assert.equal(parsePhone('+971 50 123 4567')?.e164, '+971501234567');
  });
  test('rejects wrong length, letters and fake numbers', () => {
    for (const raw of ['12345', '98765432', '987654321012', 'abc9876543210', '+999 1234567', '0000000000', '']) {
      assert.equal(parsePhone(raw), null, raw);
    }
  });
  test('schemas: required, optional, clearing and PATCH-friendly missing field', () => {
    assert.equal(phoneSchema.parse(' 98765 43210 '), '+919876543210');
    assert.equal(phoneSchema.safeParse('12345').error.issues[0].message.startsWith('Enter a valid phone number'), true);
    const o = z.object({ phone: optionalPhone }).strict();
    assert.deepEqual(o.parse({ phone: '' }), { phone: null });
    assert.deepEqual(o.parse({}), {});
    assert.equal(o.safeParse({ phone: '123' }).success, false);
  });
});

describe('E-mail addresses', () => {
  test('accepts normal addresses', () => {
    for (const e of ['priya@gmail.com', 'dr.rahul+lab@city-hospital.co.in', 'a_b@x.org']) assert.ok(isValidEmail(e), e);
  });
  test('rejects broken ones', () => {
    for (const e of ['priya@gmail', 'priya@@gmail.com', 'priya gmail.com', '.a@x.com', 'a..b@x.com', 'a@-x.com', 'a@x.c', 'a@x.123', '@x.com', 'a@x.com.']) {
      assert.equal(isValidEmail(e), false, e);
    }
  });
  test('schemas lower-case and trim', () => {
    assert.equal(emailSchema.parse('  Priya@Gmail.COM '), 'priya@gmail.com');
    assert.deepEqual(z.object({ email: optionalEmail }).parse({ email: '' }), { email: null });
  });
});

describe('Country / state / city', () => {
  before(async () => { await loadGeo(); });
  const s = withLocation(z.object({ name: z.string() }).strict());
  const req = withLocation(z.object({ name: z.string() }).strict(), { required: true });

  test('state is checked against the country and stored with its proper spelling', () => {
    assert.deepEqual(s.parse({ name: 'x', country: 'in', state: 'maharashtra', city: 'Pune' }), { name: 'x', country: 'IN', state: 'Maharashtra', city: 'Pune' });
    assert.equal(s.parse({ name: 'x', country: 'IN', state: 'MH' }).state, 'Maharashtra');
    assert.equal(s.safeParse({ name: 'x', country: 'IN', state: 'Texas' }).success, false);
    assert.equal(s.safeParse({ name: 'x', country: 'ZZ' }).success, false);
  });
  test('required mode needs country, state and city', () => {
    assert.equal(req.safeParse({ name: 'x', country: 'IN', city: 'Pune' }).success, false);
    assert.equal(req.safeParse({ name: 'x', country: 'IN', state: 'Maharashtra' }).success, false);
    assert.ok(req.safeParse({ name: 'x', country: 'IN', state: 'Maharashtra', city: 'Some Village' }).success);
  });
  test('optional mode keeps old clients working', () => {
    assert.deepEqual(s.parse({ name: 'x' }), { name: 'x' });
    assert.ok(s.safeParse({ name: 'x', city: 'Pune' }).success);
  });
  test('helpers', () => {
    assert.equal(flagOf('IN'), '🇮🇳');
    assert.equal(timezoneFor('IN'), 'Asia/Kolkata');
    assert.equal(timezoneFor('??'), 'Asia/Kolkata');
  });
});
