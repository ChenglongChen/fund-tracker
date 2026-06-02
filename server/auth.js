
/** @param {import('node:http').IncomingMessage} req */
function parseBearerToken(req) {
  const auth = String(req.headers.authorization || '');
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** @returns {Set<string>|null} null = allow all origins */
export function getAllowedOrigins() {
  const raw = process.env.FUND_TRACKER_CORS_ORIGINS?.trim();
  if (!raw || raw === '*') return null;
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 * @returns {boolean} true if request fully handled (preflight / rejected)
 */
export function handleCorsAndAuth(req, res, pathname) {
  const allowed = getAllowedOrigins();
  const origin = String(req.headers.origin || '');
  if (allowed && origin && allowed.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (!allowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, If-None-Match');
  res.setHeader('Access-Control-Expose-Headers', 'ETag');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  const token = process.env.FUND_TRACKER_API_TOKEN?.trim();
  if (!token || !pathname.startsWith('/api/')) return false;
  if (pathname === '/api/health') return false;

  const provided = parseBearerToken(req);
  if (provided !== token) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return true;
  }
  return false;
}
