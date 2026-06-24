import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

export const DATA_DIR = process.env.FUND_TRACKER_DATA_DIR?.trim()
  ? path.resolve(process.env.FUND_TRACKER_DATA_DIR)
  : path.join(ROOT, 'data');

/**
 * 原子写 JSON：先写同目录临时文件再 rename，避免崩溃/并发导致截断或损坏。
 * rename 在同一文件系统上是原子操作；读到的要么是旧内容、要么是完整新内容。
 * @param {string} filePath @param {unknown} data @param {number} [indent]
 */
export async function writeJsonAtomic(filePath, data, indent = 2) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  const json = JSON.stringify(data, null, indent);
  try {
    await fs.writeFile(tmp, json, 'utf8');
    await fs.rename(tmp, filePath);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}
