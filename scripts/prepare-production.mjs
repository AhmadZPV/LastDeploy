import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { checkPassword } from '../src/auth/policy.js';

const root = path.resolve('.');
const dbPath = path.resolve(process.env.PRODUCTION_DB_PATH || path.join(root, 'data', 'production.db'));
const username = String(process.env.PRODUCTION_ADMIN_USERNAME || 'admin').trim();
const password = String(process.env.PRODUCTION_ADMIN_PASSWORD || '');
const name = String(process.env.PRODUCTION_ADMIN_NAME || 'Administrator').trim();
const email = String(process.env.PRODUCTION_ADMIN_EMAIL || '').trim();
const team = String(process.env.PRODUCTION_TEAM || 'Team').trim();

if (!password) throw new Error('Set PRODUCTION_ADMIN_PASSWORD before preparing production.');
if (!checkPassword(password)) throw new Error('PRODUCTION_ADMIN_PASSWORD does not meet the password policy.');
if (/Online@1234|generate-a-long-random-secret/i.test(password)) throw new Error('Example credentials are not allowed in production.');
if (!username) throw new Error('PRODUCTION_ADMIN_USERNAME cannot be empty.');
if (fs.existsSync(dbPath)) throw new Error(`Refusing to overwrite existing database: ${dbPath}`);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const databaseUrl = `file:${dbPath.replace(/\\/g, '/')}`;
const prismaCli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
const pushed = spawnSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate'], {
  cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit',
});
if (pushed.status !== 0 || pushed.error) {
  fs.rmSync(dbPath, { force: true });
  throw new Error(`Could not create the production schema${pushed.error ? ': ' + pushed.error.message : '.'}`);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
try {
  const hash = await bcrypt.hash(password, 12);
  await prisma.$transaction([
    prisma.benutzer.create({ data: {
      Benutzername: username, Passwort: hash, Name: name, Email: email || null,
      active: 1, Gruppe: 'Admins', Team: team, Erstanmeldung: null,
    } }),
    prisma.intex_hausverwaltung_uggroups.create({ data: { GroupID: -1, Label: 'Admins' } }),
    prisma.intex_hausverwaltung_ugmembers.create({ data: { UserName: username, GroupID: -1 } }),
    prisma.einstellungen.create({ data: { Team: team, Waehrung: 'EUR' } }),
  ]);
  console.log(`Production database created: ${dbPath}`);
  console.log(`Admin user: ${username}`);
  console.log(`Team: ${team}`);
  console.log('Fixture rows: 0');
} catch (error) {
  await prisma.$disconnect();
  fs.rmSync(dbPath, { force: true });
  throw error;
} finally {
  await prisma.$disconnect();
}
