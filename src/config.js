import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The only place in src/ that reads process.env or loads .env. Node builtins only,
// so the report keeps working without node_modules.
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Real environment variables win: loadEnvFile never overwrites ones that are already set.
try {
  process.loadEnvFile(resolve(root, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const DEFAULT_DB_PATH = 'data/employees.db';

// Pointing DB_PATH at the default location (as .env.example does) is the same as not setting it.
const isDefaultDbPath = (path) => resolve(root, path) === resolve(root, DEFAULT_DB_PATH);

export const config = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || '127.0.0.1',
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
  dbPath: process.env.DB_PATH || DEFAULT_DB_PATH,
  dbPathIsExplicit: Boolean(process.env.DB_PATH) && !isDefaultDbPath(process.env.DB_PATH),
};
