import { parseGbSinaRaw, setQqqPremarketPct, getQqqPremarketPct } from './gb-quote-parse.js';

const NVDA_RAW =
  '英伟达,214.8600,-0.22,2026-05-27 18:20:33,-0.4700,216.5400,218.1800,212.0000,236.5400,132.8800,187202486,170263275,5204124060000,6.57,32.700000,0.00,0.00,0.25,0.00,24221000000,69,215.9500,0.51,1.09,May 27 06:20AM EDT,May 26 04:00PM EDT,215.3300,1413778,1,2026,40212605854.3129,216.2457,212.6400,303484178.3918,213.7700,214.8600';

const QQQ_RAW =
  'QQQ,717.5400,1.78,2026-05-27 09:49:46,12.5400,705.0000,720.0000,704.0000,680.0000,400.0000,1000000,900000,1000000000,1.00,25.000000,0.00,0.00,0.10,0.00,1000000000,50,716.0000,0.51,3.75,May 27 06:20AM EDT,May 26 04:00PM EDT,717.5400,1000000,1,2026,0,0,0,0,0,0';

const ok = [];
const fail = [];
function assert(name, cond) {
  (cond ? ok : fail).push(name);
}

const nvda = parseGbSinaRaw(NVDA_RAW);
assert('nvda price', nvda?.price === 214.86);
assert('nvda changePct', nvda?.changePct === -0.22);
assert('nvda regular', nvda?.changePctRegular === 1.09);
assert('nvda premarket', nvda?.changePctPremarket === 0.51);
assert('nvda reg close', nvda?.regularClosePrice === 215.33);

const qqq = parseGbSinaRaw(QQQ_RAW);
assert('qqq premarket', qqq?.changePctPremarket === 0.51);
setQqqPremarketPct(qqq?.changePctPremarket ?? null);
assert('qqq cache', getQqqPremarketPct() === 0.51);

const ASML_RAW =
  '阿斯麦,1632.9000,-0.05,2026-05-27 18:25:00,-0.8200,1640.0000,1650.0000,1620.0000,1653.5300,800.0000,100000,90000,1000000000,1.00,20.000000,0.00,0.00,0.10,0.00,1000000000,17,1655.5700,1.44,23.54,May 27 06:25AM EDT,May 26 04:00PM EDT,1632.9000,20446,1,2026,0,0,0,0,0,0';

const asml = parseGbSinaRaw(ASML_RAW);
assert('asml premarket', asml?.changePctPremarket === 1.44);
assert('asml regular rejected', asml?.changePctRegular == null);

console.log(`gb-quote-parse tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
