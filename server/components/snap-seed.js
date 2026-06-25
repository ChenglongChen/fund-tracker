import { beijingIsoString, beijingMinutesOfDay } from '../time.js';
import { resolveDisplaySession, toDisplayStatePayload } from '../display-session.js';

/** 美股收盘结算窗口结束（北京 04:45）：04:00–04:45 内 day_open snap 持续 re-seed 以收敛最终收盘，之后冻结 */
const BJ_US_CLOSE_SETTLE_END_MIN = 4 * 60 + 45;
import {
  ensureDayBaseline,
  getBaselineForDay,
  getCurrentPhase,
  getScopeSnap,
  round2,
  setBaselineForDay,
  setCurrentPhase,
  setScopeSnap,
  clearScopeSnap,
} from '../day-display-state.js';
import { buildFundSnapEntry, sessionSnapNeedsReseed } from './snap-entry.js';
import { getReadyScopeSnap, isScopeSnapReady } from './snap-ready.js';

/** snap 就绪时把 B[D] 拉回 Σ amountAtSnap，修复 NAV 入账误抬 baseline。 */
function healBaselineFromReadySnap(accrualDay, now) {
  const snap = getReadyScopeSnap(accrualDay, 'eodSnap', 'portfolio', now);
  if (snap?.est == null) return;
  const frozen = round2(snap.est - (snap.rt1 ?? 0));
  const stored = getBaselineForDay(accrualDay, 'portfolio');
  if (stored == null || Math.abs(stored - frozen) > 0.005) {
    setBaselineForDay(accrualDay, 'portfolio', frozen);
  }
}

/**
 * day_open snap 的 per-fund 正盘涨跌幅是否已偏离 live（用于修复冷启动 seed 时
 * 行情/汇率未就绪而冻结的 stale 值，如指数型 NDX 0.75 缺汇率 → live 已 0.96）。
 * settle 只改 amount 不改 impactPctRegular，故不会触发，避免入账期 re-seed 抖动。
 */
function dayOpenSnapRegularDrifted(existing, liveFunds) {
  const fundsSnap = existing?.funds;
  if (!fundsSnap) return false;
  for (const row of liveFunds) {
    const snapEntry = fundsSnap[row.id];
    if (!snapEntry) continue;
    const snapPct = snapEntry.impactPctRegular;
    const livePct = row.impactPctRegular;
    if (snapPct == null || livePct == null) continue;
    if (!Number.isFinite(snapPct) || !Number.isFinite(livePct)) continue;
    if (Math.abs(snapPct - livePct) > 0.02) return true;
    if (
      snapEntry.rt1 != null &&
      snapEntry.amountAtSnap != null &&
      Number.isFinite(snapEntry.rt1) &&
      Number.isFinite(snapEntry.amountAtSnap)
    ) {
      const expectedRt1 = round2((snapEntry.amountAtSnap * snapPct) / 100);
      if (Math.abs(expectedRt1 - snapEntry.rt1) > 1) return true;
    }
  }
  return false;
}

/** 16:00 eod_freeze snap 已就绪（非 day_open / 非 provisional）。 */
function hasReadyEodFreezeSnap(existing, now, accrualDay) {
  return (
    existing?.seedPhase === 'eod_freeze' &&
    isScopeSnapReady(existing, now, accrualDay)
  );
}

/**
 * @param {string} accrualDay
 * @param {'eodSnap'} snapKey
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} liveFunds
 * @param {object} totalsLive
 * @param {object[]} impactRawList
 * @param {Date} now
 * @param {DisplayPhase} seedPhase
 */
function seedEodSnap(
  accrualDay,
  snapKey,
  portfolio,
  liveFunds,
  totalsLive,
  impactRawList,
  now,
  seedPhase,
  baselineOverride = null,
) {
  /** @type {Record<string, object>} */
  const fundsSnap = {};
  for (let i = 0; i < portfolio.funds.length; i++) {
    const f = portfolio.funds[i];
    const liveRow = liveFunds.find((x) => x.id === f.id) ?? liveFunds[i];
    const raw = impactRawList[i] ?? {};
    const market = liveRow?.market ?? 'cn';
    fundsSnap[f.id] = buildFundSnapEntry(f, liveRow, raw, market, now);
  }
  const rt1 = round2(Object.values(fundsSnap).reduce((s, entry) => s + (entry.rt1 ?? 0), 0));
  // snap seed 冻结 B[D]=Σ amountAtSnap；入账后 baseline 不得再随 NAV 漂移。
  // 美股收盘结算窗口内 re-seed 时传入 baselineOverride 以保留首次冻结的 B[D]（仅 rt1 收敛到最终收盘）。
  const baseline =
    baselineOverride != null && Number.isFinite(baselineOverride)
      ? baselineOverride
      : round2(Object.values(fundsSnap).reduce((s, entry) => s + (entry.amountAtSnap ?? 0), 0));
  setBaselineForDay(accrualDay, 'portfolio', baseline);
  setScopeSnap(accrualDay, snapKey, 'portfolio', {
    at: beijingIsoString(now),
    seedPhase,
    rt1,
    est: round2(baseline + rt1),
    funds: fundsSnap,
  });
}

/**
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} liveFunds
 * @param {object} totalsLive
 * @param {object[]} impactRawList
 * @param {Date} [now]
 */
export function reconcileDisplayState(
  portfolio,
  liveFunds,
  totalsLive,
  impactRawList = [],
  now = new Date(),
  session = null,
) {
  ensureDayBaseline(portfolio, now);
  const s = session ?? resolveDisplaySession(now, { persistedPhase: getCurrentPhase() });
  const { accrualDay, clockPhase: targetPhase, snapKey } = s;

  if (targetPhase === 'day_open') {
    const existing = getScopeSnap(accrualDay, 'eodSnap', 'portfolio');
    // 美股 04:00 收盘后，指数/个股最终收盘价（含收盘集合竞价）通常 ~04:15–04:30 才结算到位，
    // Sina 行情 04:00 时仍是未结算值。仅在 04:00 一刻 seed 会冻结 pre-final（如 NDX 0.61 而非 0.75）。
    // 结算窗口（04:00–BJ_US_CLOSE_SETTLE_END_MIN）内每 tick re-seed，让 rt1 收敛到最终收盘；
    // 窗口外冻结。re-seed 保留首次 B[D]（baselineOverride），避免期间 settle 误抬 baseline。
    const mins = beijingMinutesOfDay(now);
    const inUsCloseSettleWindow = mins >= 4 * 60 && mins < BJ_US_CLOSE_SETTLE_END_MIN;
    const needsDayOpenSnap =
      !existing ||
      existing.seedPhase === 'us_regular_live' ||
      (existing.seedPhase !== 'day_open' && !isScopeSnapReady(existing)) ||
      (existing.seedPhase === 'day_open' &&
        (inUsCloseSettleWindow || dayOpenSnapRegularDrifted(existing, liveFunds)));
    if (needsDayOpenSnap) {
      const keepBaseline =
        existing?.seedPhase === 'day_open' ? getBaselineForDay(accrualDay, 'portfolio') : null;
      if (existing) clearScopeSnap(accrualDay, 'eodSnap', 'portfolio');
      seedEodSnap(
        accrualDay,
        'eodSnap',
        portfolio,
        liveFunds,
        totalsLive,
        impactRawList,
        now,
        targetPhase,
        keepBaseline,
      );
    }
  } else if (snapKey === 'eodSnap' && targetPhase === 'eod_freeze') {
    const existing = getScopeSnap(accrualDay, snapKey, 'portfolio');

    if (hasReadyEodFreezeSnap(existing, now, accrualDay)) {
      if (sessionSnapNeedsReseed(existing, portfolio, liveFunds, now)) {
        clearScopeSnap(accrualDay, snapKey, 'portfolio');
        seedEodSnap(
          accrualDay,
          snapKey,
          portfolio,
          liveFunds,
          totalsLive,
          impactRawList,
          now,
          targetPhase,
        );
      }
    } else {
      // 16:00 首次或仅有 day_open：用当前 live 写入 eod snap（capture ~39k），禁止 promote day_open
      if (existing) clearScopeSnap(accrualDay, snapKey, 'portfolio');
      seedEodSnap(
        accrualDay,
        snapKey,
        portfolio,
        liveFunds,
        totalsLive,
        impactRawList,
        now,
        targetPhase,
      );
    }
  } else if (
    !getScopeSnap(accrualDay, 'eodSnap', 'portfolio') &&
    (targetPhase === 'eod_freeze' || targetPhase === 'day_open')
  ) {
    seedEodSnap(
      accrualDay,
      'eodSnap',
      portfolio,
      liveFunds,
      totalsLive,
      impactRawList,
      now,
      targetPhase,
    );
  }

  setCurrentPhase(s.phaseToPersist, now);
  healBaselineFromReadySnap(accrualDay, now);

  return {
    ...toDisplayStatePayload(s),
    phase: targetPhase,
    activeSnap: snapKey ? getReadyScopeSnap(accrualDay, snapKey, 'portfolio') : null,
  };
}
