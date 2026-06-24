import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { getLiveCache, refreshLiveDisplay, buildLiveRevision, getLiveStatus } from './live.js';
import { runSettlement } from './settle.js';
import { readPortfolio, writePortfolio } from './store.js';
import { resolveFundImpact, fetchFundNavInfo, getCachedFundImpactDetail, refreshFundHoldingsDisplay, resolveFxStripFromMarket } from './market.js';
import { classifyFundMarket, valuationBasisLabel } from './components/market-hours.js';
import { resolveLiveDisplayImpact } from './market-session.js';
import { readAppState, setAssetViewMode, listDailyRecords } from './app-state.js';
import {
  buildProfitCalendar,
  buildProfitSummary,
  buildProfitWeeksInMonth,
  buildProfitYear,
  buildProfitYearsAll,
  buildDayDetail,
  buildRangeFundDetail,
} from './profit-calendar.js';
import { backfillProfitLedger } from './profit-backfill.js';
import { addFund, deleteFund, updateFund } from './fund-crud.js';
import {
  addWatchlistItem,
  buildWatchlistLive,
  readWatchlist,
  removeWatchlistItem,
} from './watchlist.js';
import { handleCorsAndAuth } from './auth.js';
import { bootstrapServer } from './bootstrap.js';
import { isScreenshotMode, getScreenshotFundDetailPack } from './screenshot-bundle.js';
import { beijingDateTimeString, beijingIsoString, beijingDateString, beijingIsoAddDays } from './time.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DEFAULT_PORT = Number(process.env.PORT) || 8788;
const gzipAsync = promisify(zlib.gzip);

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

/** @param {http.ServerResponse} res @param {number} code @param {unknown} data @param {{ req?: http.IncomingMessage, etag?: string }} [opts] */
async function json(res, code, data, opts = {}) {
  const { req = null, etag = null } = opts;
  const body = JSON.stringify(data);
  /** @type {Record<string, string | number>} */
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (etag) headers.ETag = etag;
  const acceptEncoding = String(req?.headers['accept-encoding'] || '');
  if (req && acceptEncoding.includes('gzip') && body.length >= 1024) {
    const compressed = await gzipAsync(body);
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
    headers['Content-Length'] = compressed.length;
    res.writeHead(code, headers);
    res.end(compressed);
    return;
  }
  res.writeHead(code, headers);
  res.end(body);
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

/** @param {http.IncomingMessage} req @param {http.ServerResponse} res @param {number} port */
async function handler(req, res, port) {
  const url = new URL(req.url || '/', `http://localhost:${port}`);
  const { pathname, searchParams } = url;

  if (handleCorsAndAuth(req, res, pathname)) return;

  if (req.method === 'GET' && pathname === '/api/health') {
    return json(res, 200, { ok: true, time: beijingIsoString() });
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

  if (req.method === 'GET' && pathname === '/api/live/status') {
    return json(res, 200, getLiveStatus());
  }

  if (req.method === 'GET' && pathname === '/api/live') {
    const live = getLiveCache();
    const etag = `"${live.liveRevision || buildLiveRevision(live)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      return res.end();
    }
    return json(res, 200, live, { req, etag });
  }

  if (req.method === 'GET' && pathname === '/api/watchlist') {
    try {
      const items = await readWatchlist();
      return json(res, 200, { items });
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (req.method === 'POST' && pathname === '/api/watchlist') {
    try {
      const body = JSON.parse(await readBody(req));
      const items = await addWatchlistItem(body.code, body.name);
      return json(res, 200, { items });
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  const watchlistCodeMatch = pathname.match(/^\/api\/watchlist\/(\d{6})$/);
  if (watchlistCodeMatch && req.method === 'DELETE') {
    try {
      const items = await removeWatchlistItem(watchlistCodeMatch[1]);
      return json(res, 200, { items });
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (req.method === 'GET' && pathname === '/api/watchlist/live') {
    try {
      return json(res, 200, await buildWatchlistLive());
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
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

  if (req.method === 'GET' && pathname === '/api/profit/calendar') {
    try {
      const portfolio = await readPortfolio();
      const scope = searchParams.get('scope') || 'all';
      const month = searchParams.get('month') || beijingDateString().slice(0, 7);
      const unit = searchParams.get('unit') || 'amount';
      const period = searchParams.get('period') || 'day';
      const selectedDay = searchParams.get('day') || null;
      const selectedWeekStart = searchParams.get('weekStart') || null;
      const selectedMonth = searchParams.get('monthKey') || null;
      const selectedYear = searchParams.get('yearKey') || null;

      if (scope === 'summary') {
        const summary = await buildProfitSummary({
          month,
          accounts: portfolio.accounts ?? [],
        });
        return json(res, 200, { ...summary, scope: 'summary', unit });
      }

      if (period === 'week') {
        const week = await buildProfitWeeksInMonth({
          scope,
          month,
          accounts: portfolio.accounts ?? [],
          selectedWeekStart,
        });
        return json(res, 200, { ...week, unit });
      }

      if (period === 'month') {
        const year = searchParams.get('year') || month.slice(0, 4);
        const yearView = await buildProfitYear({
          scope,
          year,
          accounts: portfolio.accounts ?? [],
          selectedMonth,
        });
        return json(res, 200, { ...yearView, unit });
      }

      if (period === 'year') {
        const yearsView = await buildProfitYearsAll({
          scope,
          accounts: portfolio.accounts ?? [],
          selectedYear,
        });
        return json(res, 200, { ...yearsView, unit });
      }

      const cal = await buildProfitCalendar({
        scope,
        month,
        unit,
        portfolio,
        accounts: portfolio.accounts ?? [],
        selectedDay,
      });
      return json(res, 200, cal);
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (req.method === 'GET' && pathname === '/api/profit/summary') {
    try {
      const portfolio = await readPortfolio();
      const month = searchParams.get('month') || beijingDateString().slice(0, 7);
      const summary = await buildProfitSummary({
        month,
        accounts: portfolio.accounts ?? [],
      });
      return json(res, 200, summary);
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (req.method === 'GET' && pathname === '/api/profit/range-detail') {
    try {
      const portfolio = await readPortfolio();
      const scope = searchParams.get('scope') || 'all';
      const from = searchParams.get('from');
      const to = searchParams.get('to');
      if (!from || !to) return json(res, 400, { error: '需要 from 与 to' });
      const detail = await buildRangeFundDetail({ scope, from, to, portfolio });
      return json(res, 200, detail);
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (req.method === 'GET' && pathname.match(/^\/api\/profit\/day\/\d{4}-\d{2}-\d{2}$/)) {
    try {
      const day = pathname.replace('/api/profit/day/', '');
      const scope = searchParams.get('scope') || 'all';
      const detail = await buildDayDetail(day, scope);
      return json(res, 200, detail);
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (req.method === 'GET' && pathname === '/api/profit/export') {
    try {
      const portfolio = await readPortfolio();
      const scope = searchParams.get('scope') || 'all';
      const month = searchParams.get('month') || beijingDateString().slice(0, 7);
      const cal =
        scope === 'summary'
          ? null
          : await buildProfitCalendar({
              scope,
              month,
              portfolio,
              accounts: portfolio.accounts ?? [],
            });
      const lines = ['date,profit,profitPct,status'];
      if (cal) {
        for (const d of cal.days) {
          lines.push(`${d.date},${d.profit ?? ''},${d.profitPct ?? ''},${d.status}`);
        }
      }
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="profit-${scope}-${month}.csv"`,
      });
      return res.end(lines.join('\n'));
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (req.method === 'POST' && pathname === '/api/profit/backfill') {
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const portfolio = await readPortfolio();
      const from = body.from || '2026-05-01';
      const to = body.to || beijingDateString();
      const result = await backfillProfitLedger(portfolio, {
        from,
        to,
        accountId: body.accountId ?? null,
      });
      return json(res, 200, result);
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
      const watchlist = await readWatchlist();
      const fund = portfolio.funds.find((f) => f.code === code);
      let fundName = fund?.name ?? '';
      if (!fundName) {
        const wlItem = watchlist.find((i) => i.code === code);
        if (wlItem?.name) fundName = wlItem.name;
      }
      if (!fundName) {
        const nav = await fetchFundNavInfo(code);
        fundName = nav?.name ?? '';
      }
      let r = isScreenshotMode() ? await getScreenshotFundDetailPack(code) : null;
      if (!r) {
        const fxStrip = resolveFxStripFromMarket(live.indices ?? []);
        r = await refreshFundHoldingsDisplay(
          getCachedFundImpactDetail(code, fundName, 120_000) ??
            (await resolveFundImpact(code, fxStrip ?? live.fxPct, fundName, live.indices ?? [])),
        );
      }
      const market = classifyFundMarket(fund ?? { name: fundName, code });
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
      const conf =
        r.valuationConfidence != null ? ` · 置信${r.valuationConfidence}` : '';
      const src = r.impactSource ? ` · 来源${r.impactSource}` : '';
      const note =
        qNum && annualY
          ? `基于Q${qNum}季报结合${annualY.slice(2)}年年报持仓计算，共 ${r.count} 支${cov}${conf}${src}`
          : recent
            ? `基于持仓报告 ${recent} 计算，共 ${r.count} 支${cov}${conf}${src}`
            : `共 ${r.count} 支重仓${cov}${conf}${src}`;
      return json(res, 200, {
        impactPct,
        rawImpactPct: r.impactPct,
        holdings: r.holdings,
        note,
        reportDate: r.reportDate,
        impactSource: r.impactSource ?? null,
        valuationConfidence: r.valuationConfidence ?? null,
        ensembleAlpha: r.ensembleAlpha ?? null,
        holdingsImpactPct: r.holdingsImpactPct ?? null,
        fundgzImpactPct: r.fundgzImpactPct ?? null,
        impactBreakdown: r.impactBreakdown ?? null,
        quoteCoverage: r.quoteCoverage ?? null,
        valuationBasis: valuationBasisLabel(market, r.impactSource ?? null),
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

/**
 * @param {{ port?: number, host?: string }} [options]
 * @returns {Promise<{ server: import('node:http').Server, port: number, host: string }>}
 */
export async function startFundTrackerServer(options = {}) {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  await bootstrapServer();
  const server = http.createServer((req, res) => {
    handler(req, res, port).catch((e) => {
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  console.log(`[${beijingDateTimeString()}] fund-tracker server http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(`[${beijingDateTimeString()}]   API: /api/portfolio /api/live /api/watchlist /api/settings /api/history/daily /api/profit/*`);
  return { server, port, host };
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  await startFundTrackerServer();
}
