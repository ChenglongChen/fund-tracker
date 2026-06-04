export const DEFAULT_ACCOUNTS = [
  { id: 'alipay', name: '支付宝', order: 0 },
  { id: 'jiashi', name: '嘉实理财', order: 1 },
  { id: 'nanfang', name: '南方基金', order: 2 },
  { id: 'guangfa', name: '广发基金', order: 3 },
  { id: 'dacheng', name: '大成基金', order: 4 },
  { id: 'efund', name: '易方达', order: 5 },
];

/**
 * 可选兜底：导入数据缺 accountId 时按 code 推断渠道。
 * 正常运行时以 portfolio 每行的 accountId 为准；开源仓库留空，避免暴露个人映射。
 * @type {Record<string, string>}
 */
const CODE_ACCOUNT_MAP = {};

/** @param {{ code: string, accountId?: string }} fund */
export function inferAccountId(fund) {
  if (fund.accountId) return fund.accountId;
  return CODE_ACCOUNT_MAP[fund.code] || 'alipay';
}

/** @param {{ meta?: object, funds: object[], accounts?: object[] }} data */
export function migratePortfolio(data) {
  const accounts = data.accounts?.length
    ? [...data.accounts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : DEFAULT_ACCOUNTS.map((a) => ({ ...a }));

  const known = new Set(accounts.map((a) => a.id));
  for (const def of DEFAULT_ACCOUNTS) {
    if (!known.has(def.id)) accounts.push({ ...def });
  }

  data.accounts = accounts.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const fund of data.funds) {
    fund.accountId = inferAccountId(fund);
  }
  return data;
}

/** @param {string} accountId @param {{ funds: object[] }} portfolio */
export function fundsForAccount(portfolio, accountId) {
  return portfolio.funds.filter((f) => f.accountId === accountId);
}

/** @param {string} accountId @param {{ accounts?: object[] }} portfolio */
export function accountById(portfolio, accountId) {
  return portfolio.accounts?.find((a) => a.id === accountId) ?? null;
}
