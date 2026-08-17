/**
 * Passcode gate. Two shared passcodes, no individual accounts (spec §2).
 *   player -> full read/write on everything
 *   gm     -> everything a player can do, plus the GM-only controls
 *
 * Deliberately simple: an HMAC-signed cookie, no user table, no password
 * hashing ceremony. This is a private tool for six people.
 */

import crypto from 'node:crypto';
import { config } from '../config.js';

export const COOKIE_NAME = 'orc_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function hmac(payload) {
  return crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('hex');
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Which role (if any) does this passcode grant? GM checked first. */
export function roleForPasscode(passcode) {
  if (!passcode) return null;
  if (config.gmPasscode && safeEqual(passcode, config.gmPasscode)) return 'gm';
  if (config.playerPasscode && safeEqual(passcode, config.playerPasscode)) return 'player';
  return null;
}

export function signSession(role) {
  const payload = `${role}.${Date.now() + MAX_AGE_MS}`;
  return `${payload}.${hmac(payload)}`;
}

export function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [role, expiry, sig] = parts;
  if (!safeEqual(sig, hmac(`${role}.${expiry}`))) return null;
  if (Number(expiry) < Date.now()) return null;
  if (role !== 'player' && role !== 'gm') return null;
  return role;
}

export function tokenFromRequest(req) {
  return (
    req.cookies?.[COOKIE_NAME] ||
    req.get?.('x-orc-token') ||
    req.headers?.['x-orc-token'] ||
    null
  );
}

/** Attaches req.role for every request; never rejects. */
export function sessionMiddleware(req, _res, next) {
  req.role = verifySession(tokenFromRequest(req));
  req.isGM = req.role === 'gm';
  next();
}

export function requireAuth(req, res, next) {
  if (!req.role) return res.status(401).json({ error: 'Passcode required.' });
  return next();
}

export function requireGM(req, res, next) {
  if (!req.role) return res.status(401).json({ error: 'Passcode required.' });
  if (req.role !== 'gm') return res.status(403).json({ error: 'GM passcode required.' });
  return next();
}

/** Pull the session token out of a raw Cookie header (for Socket.IO). */
export function tokenFromCookieHeader(header) {
  if (!header) return null;
  for (const part of String(header).split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: MAX_AGE_MS,
    secure: config.isProduction,
    path: '/',
  };
}
