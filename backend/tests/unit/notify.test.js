import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePhone, maskPhone, maskEmail, isEmail, escapeHtml } from '../../src/notify/format.js';
import { gstSplit } from '../../src/modules/clinical/logic.js';
import { GSTIN_RE } from '../../src/utils/constants.js';

describe('Messaging helpers', () => {
  test('phone numbers are normalised to country code + number', () => {
    assert.equal(normalisePhone('98765 43210'), '919876543210');
    assert.equal(normalisePhone('+91-98765-43210'), '919876543210');
    assert.equal(normalisePhone('09876543210'), '919876543210');
    assert.equal(normalisePhone('12345'), null);
    assert.equal(normalisePhone(''), null);
  });
  test('recipients are masked before being logged', () => {
    assert.equal(maskPhone('919876543210'), '91******3210');
    assert.equal(maskEmail('priya@gmail.com'), 'p****@gmail.com');
    assert.equal(maskEmail('not-an-email'), '***');
    assert.ok(isEmail('a@b.co') && !isEmail('a@b'));
  });
  test('e-mail HTML escapes user-provided text', () => {
    assert.equal(escapeHtml('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  });
});

describe('GST', () => {
  test('CGST + SGST split always adds up to the tax', () => {
    assert.deepEqual(gstSplit('180.01', false), { cgst: '90.00', sgst: '90.01', igst: '0.00' });
    assert.deepEqual(gstSplit(180, true), { cgst: '0.00', sgst: '0.00', igst: '180.00' });
    assert.deepEqual(gstSplit(0, false), { cgst: '0.00', sgst: '0.00', igst: '0.00' });
  });
  test('GSTIN format', () => {
    assert.ok(GSTIN_RE.test('27ABCDE1234F1Z5'));
    assert.ok(!GSTIN_RE.test('27ABCDE1234F1X5'));
    assert.ok(!GSTIN_RE.test('27abcde1234f1z5'));
  });
});

describe('Sending on behalf of a hospital', async () => {
  const { addressOf, headerName, formatFrom } = await import('../../src/notify/format.js');
  const { isPrivateIp } = await import('../../src/notify/hostGuard.js');
  const { seal, open, parseKey } = await import('../../src/utils/secretBox.js');
  test('From header uses the hospital name with the platform address, safely', () => {
    assert.equal(addressOf('MediCore HMS <no-reply@medicore.in>'), 'no-reply@medicore.in');
    assert.equal(addressOf('no-reply@medicore.in'), 'no-reply@medicore.in');
    assert.equal(formatFrom('Green Valley Hospital', 'no-reply@medicore.in'), '"Green Valley Hospital" <no-reply@medicore.in>');
    assert.equal(headerName('Evil"\r\nBcc: x@y.com <a>'), 'Evil Bcc: x@y.com a');
  });
  test('private and internal addresses are refused for hospital SMTP servers', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.5', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) assert.ok(isPrivateIp(ip), ip);
    for (const ip of ['8.8.8.8', '142.250.1.1', '2607:f8b0::1']) assert.ok(!isPrivateIp(ip), ip);
  });
  test('secrets round-trip with AES-GCM and detect tampering or a wrong key', () => {
    const key = parseKey(Buffer.alloc(32, 7).toString('base64'));
    const sealed = seal('smtp-password', key);
    assert.notEqual(sealed, 'smtp-password');
    assert.equal(open(sealed, key), 'smtp-password');
    // Flip the first character of the ciphertext (the last base64 character may only carry padding bits).
    const parts = sealed.split('.');
    parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
    assert.throws(() => open(parts.join('.'), key));
    assert.throws(() => open(sealed, parseKey(Buffer.alloc(32, 8).toString('base64'))));
    assert.equal(parseKey('short'), null);
  });
});
