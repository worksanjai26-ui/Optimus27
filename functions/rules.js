'use strict';
/* Pure rules shared by the callable functions (no Firebase imports, so they can be unit-tested). */

// Must match the passes in src/App.tsx. Prices and team sizes are decided here, never by the browser.
const PASSES = {
  hackathon: { price: 500, team: { min: 2, max: 4 }, pickDay: false, tab: 'Hackathon Teams' },
  oneday: { price: 300, team: null, pickDay: true, tab: 'One-Day Pass' },
  twoday: { price: 400, team: null, pickDay: false, tab: 'Two-Day Pass' },
  exclusive: { price: 500, team: null, pickDay: false, tab: 'Exclusive Pass' }
};

const ID_RE = /^OPT27-\d{5}$/;
const NAME_RE = /^[A-Z][A-Z .'-]*$/;
const PHONE_RE = /^\+?[0-9 ]{8,15}$/;

const normalizeName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const isOptimusId = (s) => typeof s === 'string' && ID_RE.test(s);
const isCapsName = (s) => typeof s === 'string' && s.length <= 60 && NAME_RE.test(s);

/** One person may hold one place per pass (and per day for the one-day pass): this is that place's key. */
const slotKey = (pass, day, optimusId) =>
  pass === 'oneday' ? `oneday_${day}_${optimusId}` : `${pass}_${optimusId}`;

/** Validates the profile fields typed by a participant; returns an error message or null. */
const profileError = ({ name, phone, college }) => {
  if (!isCapsName(normalizeName(name))) return 'Name must be in CAPITAL LETTERS only (for example: JOSEPH VIJAY).';
  if (!PHONE_RE.test(String(phone ?? '').trim())) return 'Please enter a valid phone number.';
  const c = String(college ?? '').trim();
  if (c.length < 2 || c.length > 120) return 'Please enter your college name.';
  return null;
};

/**
 * Compares a typed teammate against the people who exist. `lookup(id)` returns { name } or null.
 * "Not found" and "wrong name" give the same answer on purpose, so nobody can probe which IDs exist.
 */
const memberStatus = (member, previousIds, lookup) => {
  const id = String(member?.id ?? '').trim().toUpperCase();
  if (!isOptimusId(id)) return 'bad-format';
  if (previousIds.includes(id)) return 'duplicate';
  const found = lookup(id);
  if (!found || found.name !== normalizeName(member?.name)) return 'not-found';
  return 'ok';
};

module.exports = { PASSES, slotKey, profileError, memberStatus, normalizeName, isOptimusId, isCapsName };
