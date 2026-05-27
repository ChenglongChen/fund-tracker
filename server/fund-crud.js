import { fetchFundGz } from './market.js';
import { fundsForAccount } from './accounts.js';
import { holdingProfitPct, readPortfolio, writePortfolio } from './store.js';

/** @param {object} fund */
function normalizeFund(fund) {
  const amount = Number(fund.amount);
  const totalProfit = Number(fund.totalProfit ?? 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('持仓金额无效');
  if (!Number.isFinite(totalProfit)) throw new Error('持有收益无效');
  const row = {
    ...fund,
    amount,
    totalProfit,
    totalProfitPct: holdingProfitPct({ amount, totalProfit }),
  };
  if (fund.yesterdayProfit != null && fund.yesterdayProfit !== '') {
    row.yesterdayProfit = Number(fund.yesterdayProfit);
  }
  return row;
}

/** @param {string} code */
async function resolveFundName(code, name) {
  const trimmed = String(name || '').trim();
  if (trimmed) return trimmed;
  const gz = await fetchFundGz(code);
  return gz?.name || code;
}

/** @param {{ code: string, name?: string, amount: number, totalProfit: number, yesterdayProfit?: number, accountId?: string }} input */
export async function addFund(input) {
  const code = String(input.code || '').trim();
  if (!/^\d{6}$/.test(code)) throw new Error('基金代码需为 6 位数字');

  const accountId = String(input.accountId || '').trim();
  if (!accountId) throw new Error('缺少 accountId');

  const portfolio = await readPortfolio();
  if (!portfolio.accounts?.some((a) => a.id === accountId)) {
    throw new Error('账户不存在');
  }
  if (portfolio.funds.some((f) => f.code === code && f.accountId === accountId)) {
    throw new Error(`基金 ${code} 已在该账户持仓中`);
  }

  const name = await resolveFundName(code, input.name);
  const nextId = portfolio.funds.reduce((m, f) => Math.max(m, f.id ?? 0), 0) + 1;
  const fund = normalizeFund({
    id: nextId,
    code,
    name,
    accountId,
    amount: input.amount,
    totalProfit: input.totalProfit,
    yesterdayProfit: input.yesterdayProfit ?? 0,
  });

  portfolio.funds.push(fund);
  return writePortfolio(portfolio);
}

/** @param {number} id @param {object} patch */
export async function updateFund(id, patch) {
  const portfolio = await readPortfolio();
  const idx = portfolio.funds.findIndex((f) => f.id === id);
  if (idx < 0) throw new Error('基金不存在');

  const current = portfolio.funds[idx];
  const merged = normalizeFund({
    ...current,
    ...patch,
    id: current.id,
    code: current.code,
    name: patch.name != null && String(patch.name).trim() ? String(patch.name).trim() : current.name,
  });

  portfolio.funds[idx] = merged;
  return writePortfolio(portfolio);
}

/** @param {number} id */
export async function deleteFund(id) {
  const portfolio = await readPortfolio();
  const target = portfolio.funds.find((f) => f.id === id);
  if (!target) throw new Error('基金不存在');

  const next = portfolio.funds.filter((f) => f.id !== id);
  const accountLeft = fundsForAccount({ funds: next }, target.accountId);
  if (accountLeft.length === 0 && next.length > 0) {
    throw new Error('每个账户至少保留一只基金');
  }
  if (next.length === 0) throw new Error('至少保留一只基金');

  portfolio.funds = next;
  return writePortfolio(portfolio);
}
