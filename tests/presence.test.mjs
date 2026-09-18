import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateName, detectClient, parsePresence, Roster } from '../js/presence.js';

test('validateName accepts plain names, digits and non-ASCII letters', () => {
  assert.deepEqual(validateName('Baxter'), { ok: true, name: 'Baxter' });
  assert.deepEqual(validateName('R2D2'), { ok: true, name: 'R2D2' });
  assert.deepEqual(validateName('Jörg'), { ok: true, name: 'Jörg' });
  assert.deepEqual(validateName('Ōsaka'), { ok: true, name: 'Ōsaka' });
});

test('validateName trims the edges and composes decomposed umlauts', () => {
  assert.deepEqual(validateName('  Anna \n'), { ok: true, name: 'Anna' });
  assert.deepEqual(validateName('Jo\u0308rg'), { ok: true, name: 'Jörg' });
});

test('validateName rejects anything shorter than three letters or digits', () => {
  assert.equal(validateName('').reason, 'nameTooShort');
  assert.equal(validateName('   ').reason, 'nameTooShort');
  assert.equal(validateName('Al').reason, 'nameTooShort');
  assert.equal(validateName(undefined).reason, 'nameTooShort');
  assert.equal(validateName(42).reason, 'nameTooShort');
});

test('validateName rejects whitespace, punctuation, symbols and emoji', () => {
  for (const name of ['Anna Lena', 'Anna\tLena', 'Anna.', 'x_x_x', '<b>Bob', 'Bob😀', '😀😀😀', 'Bob\u200Bby', '1\uFE0F\u20E32\uFE0F\u20E33\uFE0F\u20E3', 'Anna\u200D']) {
    assert.equal(validateName(name).reason, 'nameInvalidCharacters', name);
  }
});

test('validateName rejects overly long names and a single repeated character', () => {
  assert.equal(validateName('a'.repeat(10) + 'b'.repeat(15)).reason, 'nameTooLong');
  assert.equal(validateName('aaaa').reason, 'nameRepetitive');
  assert.equal(validateName('AaA').reason, 'nameRepetitive');
  assert.equal(validateName('1111').reason, 'nameRepetitive');
});

test('detectClient recognises the common browsers despite their shared tokens', () => {
  const chromeMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  assert.deepEqual(detectClient(chromeMac), { browser: 'Chrome', os: 'macOS' });
  assert.deepEqual(detectClient(chromeMac, { isBrave: true }), { browser: 'Brave', os: 'macOS' });
  assert.deepEqual(
    detectClient('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'),
    { browser: 'Edge', os: 'Windows' },
  );
  assert.deepEqual(
    detectClient('Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0'),
    { browser: 'Firefox', os: 'Linux' },
  );
  assert.deepEqual(
    detectClient('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'),
    { browser: 'Safari', os: 'macOS' },
  );
  assert.deepEqual(
    detectClient('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 OPR/124.0.0.0'),
    { browser: 'Opera', os: 'Windows' },
  );
});

test('detectClient tells mobile systems and a desktop-mode iPad apart', () => {
  assert.equal(detectClient('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36').os, 'Android');
  assert.deepEqual(
    detectClient('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1'),
    { browser: 'Chrome', os: 'iOS' },
  );
  const desktopSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
  assert.equal(detectClient(desktopSafari, { maxTouchPoints: 5 }).os, 'iPadOS');
  assert.deepEqual(detectClient(''), { browser: '?', os: '?' });
});

test('parsePresence keeps valid fields and neutralises untrusted ones', () => {
  assert.deepEqual(
    parsePresence({ type: 'presence', name: ' Baxter ', browser: 'Brave', os: 'macOS', sharing: true, hello: true }),
    { name: 'Baxter', browser: 'Brave', os: 'macOS', sharing: true, hello: true },
  );
  assert.deepEqual(
    parsePresence({ type: 'presence', name: 'Baxter', browser: '<script>', os: 12, sharing: 'yes' }),
    { name: 'Baxter', browser: '?', os: '?', sharing: false, hello: false },
  );
  assert.equal(parsePresence({ type: 'presence', name: '💩💩💩' }), null);
  assert.equal(parsePresence(null), null);
});

test('Roster reports new peers once and forgets them on remove', () => {
  const roster = new Roster();
  const entry = { name: 'Anna', browser: 'Firefox', os: 'Linux', sharing: false };

  assert.equal(roster.update('p1', entry), true);
  assert.equal(roster.update('p1', { ...entry, sharing: true }), false);
  assert.equal(roster.get('p1').sharing, true);
  assert.deepEqual(roster.remove('p1'), { ...entry, sharing: true });
  assert.equal(roster.get('p1'), undefined);
});

test('Roster.list puts the local client first, sorts by name and keeps unannounced members', () => {
  const roster = new Roster();
  roster.update('p2', { name: 'Zoe', browser: 'Safari', os: 'iOS', sharing: true });
  roster.update('p3', { name: 'Anna', browser: 'Firefox', os: 'Linux', sharing: false });
  roster.update('gone', { name: 'Ghost', browser: 'Chrome', os: 'Windows', sharing: false });
  const self = { name: 'Baxter', browser: 'Brave', os: 'macOS', sharing: false };

  const rows = roster.list(['p2', 'me', 'p4', 'p3'], 'me', self);

  assert.deepEqual(rows.map((row) => [row.peerId, row.name, row.isSelf]), [
    ['me', 'Baxter', true],
    ['p3', 'Anna', false],
    ['p2', 'Zoe', false],
    ['p4', null, false],
  ]);
});

test('Roster.list shows the local client even before the member list includes it', () => {
  const rows = new Roster().list([], 'me', { name: 'Baxter', browser: 'Brave', os: 'macOS', sharing: false });
  assert.deepEqual(rows.map((row) => row.peerId), ['me']);
});

test('detectClient counts headless Chrome as Chrome, not Safari', () => {
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36';
  assert.equal(detectClient(ua).browser, 'Chrome');
});
