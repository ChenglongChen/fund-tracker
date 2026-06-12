import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

export const DATA_DIR = process.env.FUND_TRACKER_DATA_DIR?.trim()
  ? path.resolve(process.env.FUND_TRACKER_DATA_DIR)
  : path.join(ROOT, 'data');
