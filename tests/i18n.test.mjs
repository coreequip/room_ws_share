import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLocale, createTranslator } from '../js/i18n.js';

test('detectLocale picks German when a de-* language is preferred', () => {
  assert.equal(detectLocale(['de-DE', 'en-US']), 'de');
});

test('detectLocale falls back to English for unsupported languages', () => {
  assert.equal(detectLocale(['fr-FR', 'es-ES']), 'en');
});

test('detectLocale defaults to English when no languages are given', () => {
  assert.equal(detectLocale([]), 'en');
});

test('createTranslator returns the localized string for a plain key', () => {
  const tDe = createTranslator('de');
  assert.equal(tDe('shareStart'), 'Bildschirm teilen (S)');
  const tEn = createTranslator('en');
  assert.equal(tEn('shareStart'), 'Share screen (S)');
});

test('createTranslator resolves function-valued entries with arguments', () => {
  const t = createTranslator('de');
  assert.equal(t('statusConnectError', 'timeout'), 'Verbindung fehlgeschlagen: timeout');
});

test('createTranslator falls back to English for an unknown locale', () => {
  const t = createTranslator('fr');
  assert.equal(t('shareStart'), 'Share screen (S)');
});

test('createTranslator resolves the zoom toggle labels in both locales', () => {
  const tDe = createTranslator('de');
  assert.equal(tDe('zoomEnter'), 'Zoom (Z)');
  assert.equal(tDe('zoomExit'), 'Zoom beenden (Z)');
  const tEn = createTranslator('en');
  assert.equal(tEn('zoomEnter'), 'Zoom (Z)');
  assert.equal(tEn('zoomExit'), 'Exit zoom (Z)');
});

test('createTranslator resolves the connection-info direction labels with arguments', () => {
  const tDe = createTranslator('de');
  assert.equal(tDe('infoDirectionSending', 'ab12cd34'), 'Du teilst mit ab12cd34');
  assert.equal(tDe('infoDirectionReceiving', 'ab12cd34'), 'ab12cd34 teilt mit dir');
  const tEn = createTranslator('en');
  assert.equal(tEn('infoDirectionSending', 'ab12cd34'), "You're sharing with ab12cd34");
  assert.equal(tEn('infoDirectionReceiving', 'ab12cd34'), 'ab12cd34 is sharing with you');
});

test('createTranslator resolves member join/leave toast messages with arguments', () => {
  const tDe = createTranslator('de');
  assert.equal(tDe('memberJoined', 'ab12cd34'), 'ab12cd34 ist beigetreten');
  assert.equal(tDe('memberLeft', 'ab12cd34'), 'ab12cd34 hat den Raum verlassen');
  const tEn = createTranslator('en');
  assert.equal(tEn('memberJoined', 'ab12cd34'), 'ab12cd34 joined');
  assert.equal(tEn('memberLeft', 'ab12cd34'), 'ab12cd34 left the room');
});

test('createTranslator resolves the member widget texts, with English pluralization', () => {
  const tDe = createTranslator('de');
  assert.equal(tDe('memberCountText', 1), '1 Benutzer');
  assert.equal(tDe('memberCountText', 3), '3 Benutzer');
  assert.equal(tDe('memberWidgetNoShare'), 'Keine Freigabe');
  assert.equal(tDe('memberWidgetBitrate', 1234), '1234 kbps');
  const tEn = createTranslator('en');
  assert.equal(tEn('memberCountText', 1), '1 user');
  assert.equal(tEn('memberCountText', 3), '3 users');
  assert.equal(tEn('memberWidgetNoShare'), 'No active share');
});
