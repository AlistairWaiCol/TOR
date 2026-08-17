import express from 'express';
import { COOKIE_NAME, cookieOptions, roleForPasscode, signSession } from '../lib/auth.js';

const router = express.Router();

router.get('/session', (req, res) => {
  res.json({ role: req.role, isGM: req.role === 'gm' });
});

router.post('/login', (req, res) => {
  const role = roleForPasscode(req.body?.passcode);
  if (!role) return res.status(401).json({ error: 'That passcode is not recognised.' });
  const token = signSession(role);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  // The token is also returned so scripts / tests can use the x-orc-token header.
  return res.json({ role, isGM: role === 'gm', token });
});

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

export default router;
