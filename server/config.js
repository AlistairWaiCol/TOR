import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });

export const config = {
  port: Number(process.env.PORT) || 3001,
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  playerPasscode: process.env.PLAYER_PASSCODE || 'changeme',
  gmPasscode: process.env.GM_PASSCODE || 'changeme-gm',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  discordWebhookUrl: (process.env.DISCORD_WEBHOOK_URL || '').trim(),
  dbClient: process.env.DB_CLIENT || 'sqlite',
  databaseUrl: process.env.DATABASE_URL || 'file:./data/one-ring.db',
  isProduction: process.env.NODE_ENV === 'production',
};

export const paths = {
  uploads: path.join(projectRoot, 'uploads'),
  originals: path.join(projectRoot, 'uploads', 'originals'),
  derivatives: path.join(projectRoot, 'uploads', 'derivatives'),
  seed: path.join(projectRoot, 'uploads', 'seed'),
  clientDist: path.join(projectRoot, 'dist'),
};
