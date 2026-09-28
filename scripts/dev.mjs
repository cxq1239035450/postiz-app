import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: resolve(root, '.env') });
const webOnly = process.argv.includes('--web-only');
const pnpm = process.env.npm_execpath;
const children = new Set();
let stopping = false;

// Each app inherits the terminal directly. Do not pipe Nest's watch output
// through pnpm's recursive parallel reporter on Windows.
function start(app) {
  if (stopping) throw new Error('Startup cancelled');
  console.log(`[dev] Starting ${app}...`);
  const child = spawn(process.execPath, [pnpm, '--filter', `./apps/${app}`, 'run', 'dev'], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  children.add(child);
  child.on('error', (error) => {
    console.error(`[dev] ${app}: ${error.message}`);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[dev] ${app} exited (${signal || code}); stopping all apps.`);
      shutdown(code || 1);
    }
  });
}

function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid) continue;
    if (process.platform === 'win32') {
      // Only terminate trees launched by this supervisor, never arbitrary node processes.
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    }
  }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
if (process.platform === 'win32') process.on('SIGBREAK', () => shutdown(130));

function reachable(host, port) {
  return new Promise((done) => {
    const socket = net.connect({ host, port });
    const finish = (result) => { socket.destroy(); done(result); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1500, () => finish(false));
  });
}

async function waitFor(label, check) {
  const deadline = Date.now() + 240_000;
  let nextNotice = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await check()) {
      console.log(`[dev] ${label} ready.`);
      return;
    }
    if (Date.now() >= nextNotice) {
      console.log(`[dev] Waiting for ${label}; compilation alone does not mean the server is ready.`);
      nextNotice = Date.now() + 20_000;
    }
    await delay(1000);
  }
  throw new Error(`${label} did not become ready within 240 seconds. Check the logs above.`);
}

async function httpOK(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    await response.body?.cancel();
    return response.ok;
  } catch { return false; }
}

try {
  if (!pnpm) throw new Error('Run this launcher with pnpm run dev.');
  const backendPort = Number(process.env.PORT || 3000);
  const workerPort = Number(process.env.ORCHESTRATOR_PORT || 3002);
  const ports = webOnly ? [backendPort, 4200] : [backendPort, workerPort, 4200, 8081];
  for (const port of ports) {
    if (await reachable('localhost', port)) {
      throw new Error(`Port ${port} is already in use. Stop the previous dev session before restarting.`);
    }
  }
  const temporal = new URL(`http://${process.env.TEMPORAL_ADDRESS || 'localhost:7233'}`);
  if (!(await reachable(temporal.hostname, Number(temporal.port || 7233)))) {
    throw new Error('Temporal is unavailable. Run pnpm run dev:temporal first.');
  }

  start('backend');
  await waitFor('backend', () => httpOK(`http://localhost:${backendPort}/`));
  if (!webOnly) {
    start('orchestrator');
    await waitFor('orchestrator', () => httpOK(`http://localhost:${workerPort}/health/status`));
  }
  start('frontend');
  await waitFor('frontend', () => reachable('localhost', 4200));
  if (!webOnly) {
    start('extension');
    await waitFor('extension reload server', () => reachable('localhost', 8081));
  }
  console.log('[dev] Ready: http://localhost:4200 — Ctrl+C stops this entire dev session.');
} catch (error) {
  console.error(`[dev] ${error.message}`);
  shutdown(1);
}
