/** @param {string} text @param {string} varName */
export function extractQuotedVar(text, varName) {
  const re = new RegExp(`var\\s+${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*"([^"]*)"`);
  const m = text.match(re);
  return m ? m[1] : null;
}
