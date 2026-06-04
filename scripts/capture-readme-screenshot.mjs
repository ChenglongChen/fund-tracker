/**
 * README 预览图批量截图（Mac 手机壳 393×852 · 浅色 · 示例数据）。
 * 自包含：准备 demo data → 启动 API → 逐页截图 → 退出。
 *
 *   npm run screenshot:readme
 */
import { chromium } from 'playwright';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE_DIR = join(ROOT, 'scripts', 'fixtures', 'screenshot');
const DATA_DIR = join(ROOT, '.tmp', 'screenshot-data');
const SCREENSHOT_NOW = '2026-05-29T17:00:00+08:00';
const OUT_DIR = join(ROOT, 'docs', 'screenshots');
const PORT = process.env.SCREENSHOT_PORT || '8792';
const BASE = `http://127.0.0.1:${PORT}`;

/** @type {{ file: string, hash?: string, wait?: string, delay?: number, action?: (page: import('playwright').Page) => Promise<void> }[]} */
const SHOTS = [
  { file: 'holdings-summary.png', hash: 'summary', wait: '.yj-summary-grid' },
  { file: 'holdings-all.png', hash: 'all', wait: '.holding-row' },
  { file: 'holdings-account.png', hash: 'account/alipay', wait: '.holding-row' },
  {
    file: 'holdings-detail.png',
    action: async (page) => {
      await navHash(page, 'all');
      await page.waitForSelector('[data-fund-code="270023"]', { timeout: 45000 });
      await page.click('[data-fund-code="270023"]');
      await page.waitForSelector('.detail-page', { timeout: 90000 });
      await sleep(8000);
    },
  },
  { file: 'profit-calendar.png', hash: 'profit/all', wait: '.profit-day-grid', delay: 4000 },
  { file: 'profit-summary.png', hash: 'profit/summary', wait: '.profit-summary-list', delay: 3000 },
  { file: 'watchlist.png', hash: 'watchlist', wait: '.watchlist-page .holding-row', delay: 5000 },
  {
    file: 'watchlist-detail.png',
    action: async (page) => {
      await navHash(page, 'watchlist');
      await page.waitForSelector('[data-watchlist-code="006479"]', { timeout: 45000 });
      await page.click('[data-watchlist-code="006479"]');
      await page.waitForSelector('.detail-page', { timeout: 90000 });
      await sleep(8000);
    },
  },
  { file: 'profile.png', hash: 'profile', wait: '.profile-page-title' },
];

async function prepareDemoData() {
  await rm(DATA_DIR, { recursive: true, force: true });
  await mkdir(DATA_DIR, { recursive: true });
  for (const name of await readdir(BUNDLE_DIR)) {
    if (name === 'README.md') continue;
    await cp(join(BUNDLE_DIR, name), join(DATA_DIR, name));
  }
}

/** @returns {Promise<import('node:child_process').ChildProcess>} */
async function startServer() {
  await prepareDemoData();
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      FUND_TRACKER_DATA_DIR: DATA_DIR,
      FUND_TRACKER_NOW: SCREENSHOT_NOW,
      FUND_TRACKER_SCREENSHOT: '1',
      PORT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return child;
    } catch {
      /* retry */
    }
    if (child.exitCode != null) {
      throw new Error(`API exited early (${child.exitCode})`);
    }
    await sleep(400);
  }
  child.kill('SIGTERM');
  throw new Error('API health check timeout');
}

/** @param {import('playwright').Page} page @param {string} hash */
async function navHash(page, hash) {
  await page.evaluate((h) => {
    location.hash = h ? `#${h}` : '';
  }, hash);
  await sleep(1200);
}

/** @param {import('playwright').Page} page */
async function bootApp(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#app .app-shell', { timeout: 45000 });
  await sleep(3000);
}

/** @param {import('playwright').Page} page @param {{ file: string, hash?: string, wait?: string, delay?: number, action?: (page: import('playwright').Page) => Promise<void> }} shot */
async function captureShot(page, shot) {
  if (shot.action) {
    await shot.action(page);
  } else {
    await navHash(page, shot.hash ?? '');
    if (shot.wait) {
      await page.waitForSelector(shot.wait, { timeout: 60000 });
    } else {
      await page.waitForSelector('#app .app-shell', { timeout: 45000 });
    }
    await sleep(shot.delay ?? 3500);
  }
  const out = join(OUT_DIR, shot.file);
  await page.screenshot({ path: out, type: 'png' });
  console.log(`  ✓ ${shot.file}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log('Starting demo API…');
  const server = await startServer();

  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
  });

  await page.addInitScript(() => {
    window.fundTrackerDesktop = { isDesktop: true };
    try {
      localStorage.setItem('fund-tracker-theme', 'light');
      document.documentElement.dataset.theme = 'light';
    } catch {
      /* ignore */
    }
  });

  console.log('Capturing screenshots (light mode)…');
  await bootApp(page);
  for (const shot of SHOTS) {
    await captureShot(page, shot);
  }

  await browser.close();
  server.kill('SIGTERM');
  console.log(`Done → ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
