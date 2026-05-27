import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLiveCache, refreshLiveDisplay, startSchedulers } from './live.js';
import { runSettlement, settleIfNeeded } from './settle.js';
import { ensurePortfolio, readPortfolio, writePortfolio } from './store.js';
import { resolveFundImpact } from './market.js';
import { classifyFundMarket } from './components/market-hours.js';
import { resolveLiveDisplayImpact, seedFundRegularSnapshots } from './market-session.js';
import { loadImpactSnapshots, getFundSnapshotRecords } from './impact-snapshots.js';
import { loadDayDisplayState } from './day-display-state.js';
import { seedSessionQuoteSnapshots } from './session-quotes.js';
import { readAppState, setAssetViewMode, listDailyRecords } from './app-state.js';
import { addFund, deleteFund, updateFund } from './fund-crud.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 8788;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** @param {http.IncomingMessage} req */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** @param {http.ServerResponse} res @param {number} code @param {unknown} data */
function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/** @param {http.ServerResponse} res @param {string} filePath */
async function sendFile(res, filePath) {
  try {
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

/** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
async function handler(req, res) {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const { pathname, searchParams } = url;

  if (req.method === 'GET' && pathname === '/api/health') {
    return json(res, 200, { ok: true, time: new Date().toISOString() });
  }

  if (req.method === 'GET' && pathname === '/api/portfolio') {
    try {
      return json(res, 200, await readPortfolio());
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (req.method === 'PUT' && pathname === '/api/portfolio') {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body?.funds?.length) return json(res, 400, { error: '需要 funds 数组' });
      const current = await readPortfolio();
      if (
        current.funds.length > 1 &&
        body.funds.length < current.funds.length &&
        !body.meta?.allowFundRemove
      ) {
        return json(res, 400, {
          error: `拒绝保存：新数据只有 ${body.funds.length} 只基金，当前有 ${current.funds.length} 只`,
        });
      }
      return json(res, 200, await writePortfolio(body));
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (req.method === 'POST' && pathname === '/api/funds') {
    try {
      const body = JSON.parse(await readBody(req));
      const saved = await addFund(body);
      return json(res, 200, saved);
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  const fundIdMatch = pathname.match(/^\/api\/funds\/(\d+)$/);
  if (fundIdMatch) {
    const fundId = parseInt(fundIdMatch[1], 10);
    if (req.method === 'PATCH') {
      try {
        const body = JSON.parse(await readBody(req));
        const saved = await updateFund(fundId, body);
        return json(res, 200, saved);
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (req.method === 'DELETE') {
      try {
        const saved = await deleteFund(fundId);
        return json(res, 200, saved);
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  if (req.method === 'GET' && pathname === '/api/live') {
    return json(res, 200, getLiveCache());
  }

  if (req.method === 'GET' && pathname === '/api/settings') {
    try {
      const appState = await readAppState();
      const live = getLiveCache();
      return json(res, 200, {
        assetViewMode: appState.assetViewMode,
        display: live.display,
        displayContext: live.displayContext,
      });
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (req.method === 'PUT' && pathname === '/api/settings') {
    try {
      const body = JSON.parse(await readBody(req));
      if (body.assetViewMode !== 'settled' && body.assetViewMode !== 'realtime') {
        return json(res, 400, { error: 'assetViewMode 需为 settled 或 realtime' });
      }
      const appState = await setAssetViewMode(body.assetViewMode);
      await refreshLiveDisplay();
      const live = getLiveCache();
      return json(res, 200, {
        assetViewMode: appState.assetViewMode,
        display: live.display,
        displayContext: live.displayContext,
      });
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (req.method === 'GET' && pathname === '/api/history/daily') {
    try {
      const limit = Number(searchParams.get('limit') || 30);
      return json(res, 200, { records: await listDailyRecords(limit) });
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (req.method === 'POST' && pathname === '/api/settle/run') {
    try {
      const portfolio = await readPortfolio();
      const result = await runSettlement(portfolio, {
        dryRun: searchParams.has('dryRun'),
      });
      return json(res, 200, result);
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (req.method === 'GET' && pathname === '/api/status') {
    try {
      const portfolio = await readPortfolio();
      const live = getLiveCache();
      return json(res, 200, {
        portfolio: {
          snapshotDate: portfolio.meta?.snapshotDate,
          fundCount: portfolio.funds.length,
          lastAutoSettleAt: portfolio.meta?.lastAutoSettleAt,
        },
        live: {
          updatedAt: live.updatedAt,
          quoteUpdatedAt: live.quoteUpdatedAt,
          beijingDate: live.beijingDate,
          error: live.error,
          fundCount: live.funds.length,
          assetViewMode: live.assetViewMode,
          display: live.display,
        },
      });
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  const detailMatch = pathname.match(/^\/api\/fund\/([^/]+)\/detail$/);
  if (req.method === 'GET' && detailMatch) {
    try {
      const code = decodeURIComponent(detailMatch[1]);
      const live = getLiveCache();
      const portfolio = await readPortfolio();
      const fund = portfolio.funds.find((f) => f.code === code);
      const r = await resolveFundImpact(code, live.fxPct, fund?.name ?? '', live.indices ?? []);
      const market = classifyFundMarket(fund ?? { name: '' });
      const displayImpact = resolveLiveDisplayImpact(fund?.id ?? null, market, r);
      const impactPct = displayImpact.impactPct;
      const recent = r.recentReportDate || r.reportDate;
      const annual = r.annualReportDate || null;
      const recentQ = recent?.match(/-(\d{2})-/);
      const qNum = recentQ ? Math.ceil(parseInt(recentQ[1], 10) / 3) : null;
      const annualY = annual ? annual.slice(0, 4) : '';
      const cov =
        r.quoteCoverage != null && Number.isFinite(r.quoteCoverage)
          ? `，行情覆盖约 ${r.quoteCoverage.toFixed(0)}%`
          : r.weightCoverage != null && Number.isFinite(r.weightCoverage)
            ? `，披露权重约 ${r.weightCoverage.toFixed(0)}%`
            : '';
      const note =
        qNum && annualY
          ? `基于Q${qNum}季报结合${annualY.slice(2)}年年报持仓计算，共 ${r.count} 支${cov}`
          : recent
            ? `基于持仓报告 ${recent} 计算，共 ${r.count} 支${cov}`
            : `共 ${r.count} 支重仓${cov}`;
      return json(res, 200, {
        impactPct,
        rawImpactPct: r.impactPct,
        holdings: r.holdings,
        note,
        reportDate: r.reportDate,
      });
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (req.method === 'GET' && !pathname.startsWith('/api')) {
    const safe = pathname.replace(/\.\./g, '');
    const rel = safe === '/' ? '/index.html' : safe;
    const filePath = path.join(DIST, rel);
    if (!filePath.startsWith(DIST)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) return sendFile(res, filePath);
    } catch {
      /* SPA */
    }
    return sendFile(res, path.join(DIST, 'index.html'));
  }

  res.writeHead(404);
  res.end('Not found');
}

await ensurePortfolio();
await loadImpactSnapshots();
await loadDayDisplayState();
seedSessionQuoteSnapshots();
seedFundRegularSnapshots(getFundSnapshotRecords());
startSchedulers(settleIfNeeded);

http.createServer((req, res) => {
  handler(req, res).catch((e) => {
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  });
}).listen(PORT, () => {
  console.log(`fund-tracker server http://localhost:${PORT}`);
  console.log('  API: /api/portfolio /api/live /api/settings /api/history/daily');
});
