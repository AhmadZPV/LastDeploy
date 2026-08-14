import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve('.');
const source = path.join(root, 'prisma', 'dev.db');
const target = path.join(root, 'prisma', 'playwright.db');
const sessionDir = path.join(root, 'data', 'playwright-sessions');
fs.copyFileSync(source, target);
fs.rmSync(sessionDir, { recursive: true, force: true });

const env = {
  ...process.env,
  PORT: '3100',
  DATABASE_URL: 'file:./playwright.db',
  SESSION_DIR: sessionDir,
  SESSION_SECRET: 'playwright-isolated-test-secret',
  SESSION_COOKIE_SECURE: 'false',
  PW_BASE_URL: 'http://localhost:3100',
};

const server = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
server.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk); });

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try { const r = await fetch('http://localhost:3100/healthz'); if (r.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Disposable server did not become ready\n' + output);
}

let code = 1;
try {
  await waitForServer();
  code = await new Promise((resolve) => {
    const test = spawn(process.execPath, ['tests/playwright-user-flows.mjs'], { cwd: root, env, stdio: 'inherit' });
    test.on('exit', (status) => resolve(status ?? 1));
  });
} finally {
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
}
process.exitCode = code;
