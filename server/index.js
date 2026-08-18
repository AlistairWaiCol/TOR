import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import { config, paths } from './config.js';
import { migrate } from './db/migrate.js';
import { sessionMiddleware } from './lib/auth.js';
import { ensureDirs } from './lib/images.js';
import apiRoutes from './routes/index.js';
import { attachRealtime } from './realtime.js';

migrate();
await ensureDirs();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());
app.use(sessionMiddleware);

// Vite dev server runs on a different origin; allow it through with credentials.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && origin === config.clientOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-orc-token');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, role: req.role ?? null, db: config.dbClient });
});

app.use('/api', apiRoutes);

// NOTE: uploads/ is deliberately NOT served statically. Map pixels only ever
// leave through /api/map/calibrations/:id/image/:tier, which can only read from
// uploads/derivatives — the multi-MB original is unreachable over HTTP.

// Production build (Railway, later): serve the built client.
if (fs.existsSync(paths.clientDist)) {
  app.use(express.static(paths.clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(paths.clientDist, 'index.html'));
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong.' });
});

const server = http.createServer(app);
attachRealtime(server);

server.listen(config.port, () => {
  console.log(`\n  One Ring Companion API  http://localhost:${config.port}`);
  console.log(`  Client (vite dev)       ${config.clientOrigin}`);
  console.log(`  Database                ${config.dbClient} — ${config.databaseUrl}`);
  console.log(
    `  Discord webhook         ${config.discordWebhookUrl ? 'configured' : 'not configured (posting skipped)'}\n`,
  );
});

export { app, server };
