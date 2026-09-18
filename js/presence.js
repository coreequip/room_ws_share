export const NAME_MIN_LENGTH = 3;
export const NAME_MAX_LENGTH = 24;

export const BROWSERS = ['Brave', 'Edge', 'Opera', 'Vivaldi', 'Samsung Internet', 'Firefox', 'Chrome', 'Safari'];
export const SYSTEMS = ['iOS', 'iPadOS', 'Android', 'ChromeOS', 'Windows', 'macOS', 'Linux'];
export const UNKNOWN = '?';

// A letter or decimal digit, optionally followed by combining marks -- scripts
// like Devanagari need those. Emoji, whitespace, punctuation and symbols all
// fall outside, which is the point: a name has to be something you can say.
const NAME_RE = /^(?:[\p{L}\p{Nd}][\p{Mn}\p{Mc}]*)+$/u;
// Variation selectors are nonspacing marks too, and would otherwise let a
// keycap emoji like "1" + U+FE0F + U+20E3 through as "digit plus mark".
const VARIATION_SELECTOR_RE = /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u;
const BASE_CHAR_RE = /[\p{L}\p{Nd}]/gu;

// Returns the cleaned-up name, or the i18n key saying what is wrong with it.
// The same check runs on names that arrive from other peers, so nothing the
// input field would reject can reach the roster by bypassing the dialog.
export function validateName(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'nameTooShort' };
  const name = raw.normalize('NFC').trim();
  if (name === '') return { ok: false, reason: 'nameTooShort' };
  if (!NAME_RE.test(name) || VARIATION_SELECTOR_RE.test(name)) return { ok: false, reason: 'nameInvalidCharacters' };
  const baseChars = name.match(BASE_CHAR_RE);
  if (baseChars.length < NAME_MIN_LENGTH) return { ok: false, reason: 'nameTooShort' };
  if (baseChars.length > NAME_MAX_LENGTH) return { ok: false, reason: 'nameTooLong' };
  // "aaa" or "1111" passes every rule above and is still not a name.
  if (new Set(baseChars.map((char) => char.toLowerCase())).size === 1) return { ok: false, reason: 'nameRepetitive' };
  return { ok: true, name };
}

// Order matters: Edge, Opera, Vivaldi and Samsung all carry "Chrome/" in their
// user agent, and every Chromium browser carries "Safari/". Brave's user agent
// is indistinguishable from Chrome's, so it has to be told apart by the caller
// (navigator.brave).
export function detectClient(userAgent = '', { isBrave = false, maxTouchPoints = 0 } = {}) {
  return { browser: detectBrowser(userAgent, isBrave), os: detectOs(userAgent, maxTouchPoints) };
}

function detectBrowser(ua, isBrave) {
  if (isBrave) return 'Brave';
  if (/\bEdg(?:e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/\bOPR\/|\bOpera\b/.test(ua)) return 'Opera';
  if (/\bVivaldi\//.test(ua)) return 'Vivaldi';
  if (/\bSamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) return 'Firefox';
  if (/(?:\b|Headless)Chrome\/|\bChromium\/|\bCriOS\//.test(ua)) return 'Chrome';
  if (/\bSafari\//.test(ua)) return 'Safari';
  return UNKNOWN;
}

function detectOs(ua, maxTouchPoints) {
  if (/\biPad\b/.test(ua)) return 'iPadOS';
  if (/\biPhone\b|\biPod\b/.test(ua)) return 'iOS';
  if (/\bAndroid\b/.test(ua)) return 'Android';
  if (/\bCrOS\b/.test(ua)) return 'ChromeOS';
  if (/\bWindows\b/.test(ua)) return 'Windows';
  // An iPad asks for the desktop site by default and then claims to be a Mac;
  // only the touch screen gives it away.
  if (/\bMacintosh\b|\bMac OS X\b/.test(ua)) return maxTouchPoints > 1 ? 'iPadOS' : 'macOS';
  if (/\bLinux\b/.test(ua)) return 'Linux';
  return UNKNOWN;
}

// Everything in a presence message comes from another browser and is treated
// as untrusted: an invalid name drops the whole message, an unknown browser or
// system is shown as "?" instead of whatever text was sent.
export function parsePresence(message) {
  if (!message || typeof message !== 'object') return null;
  const { ok, name } = validateName(message.name);
  if (!ok) return null;
  return {
    name,
    browser: BROWSERS.includes(message.browser) ? message.browser : UNKNOWN,
    os: SYSTEMS.includes(message.os) ? message.os : UNKNOWN,
    sharing: message.sharing === true,
    hello: message.hello === true,
  };
}

// Who is in the room and what they announced about themselves. Membership
// itself comes from the server; this only holds the details, so a member
// without an entry is someone whose presence has not arrived (yet).
export class Roster {
  constructor() {
    this._entries = new Map(); // peerId -> { name, browser, os, sharing }
  }

  // Returns true when the peer was not known before.
  update(peerId, { name, browser, os, sharing }) {
    const isNew = !this._entries.has(peerId);
    this._entries.set(peerId, { name, browser, os, sharing });
    return isNew;
  }

  remove(peerId) {
    const entry = this._entries.get(peerId);
    this._entries.delete(peerId);
    return entry;
  }

  get(peerId) {
    return this._entries.get(peerId);
  }

  // One row per member, the local client first, the rest by name so the list
  // does not reshuffle whenever someone reconnects.
  list(memberIds, selfId, self) {
    const rows = memberIds.map((peerId) => (peerId === selfId
      ? { peerId, isSelf: true, ...self }
      : { peerId, isSelf: false, ...(this._entries.get(peerId) ?? { name: null, browser: UNKNOWN, os: UNKNOWN, sharing: false }) }));
    if (selfId && !memberIds.includes(selfId)) rows.push({ peerId: selfId, isSelf: true, ...self });
    return rows.sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      if (a.name === null || b.name === null) return a.name === null ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }
}
