// Zero-dependency server (Node 18+). No npm install needed.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader
try {
  for (const line of fs.readFileSync(path.join(here, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { console.error('Missing server/.env (copy from .env.example)'); process.exit(1); }

const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_API_BASE, PAYPAL_JS_SDK_BASE, CURRENCY = 'USD', PORT = 3099 } = process.env;
if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET || !PAYPAL_API_BASE) {
  console.error('Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_API_BASE in .env');
  process.exit(1);
}

async function accessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!r.ok) throw new Error(`OAuth failed: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

// Calls PayPal and prints the full JSON response in this terminal.
async function paypal(p, body) {
  const token = await accessToken();
  const r = await fetch(`${PAYPAL_API_BASE}${p}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': crypto.randomUUID() },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  console.log(`\n=== PayPal ${p} -> HTTP ${r.status} ===`);
  console.log(JSON.stringify(data, null, 2));
  return { status: r.status, data };
}

const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok) => { let s = ''; req.on('data', c => s += c); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } }); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    // Page -> server logging, prints in this terminal
    if (req.method === 'POST' && url.pathname === '/api/log') {
      const body = await readBody(req);
      console.log(`\n=== [${body.label}] ===`);
      console.log(JSON.stringify(body.data, null, 2));
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/config')
      return send(res, 200, { clientId: PAYPAL_CLIENT_ID, currency: CURRENCY, sdkBase: PAYPAL_JS_SDK_BASE || 'https://www.paypal.com' });

    // Orders v2: create
    if (req.method === 'POST' && url.pathname === '/api/orders') {
      const body = await readBody(req);
      const { status, data } = await paypal('/v2/checkout/orders', {
        intent: 'AUTHORIZE',
        // Orders (Save) pattern: order is saved explicitly via POST /v2/checkout/orders/{id}/save after payer approval
        processing_instruction: 'ORDER_SAVED_EXPLICITLY',
        purchase_units: [{ amount: { currency_code: CURRENCY, value: String(body.amount ?? '10.00') } }]
      });
      return send(res, status, data);
    }

    // Orders v2: save (after payer approval). No request body per the docs.
    const sav = url.pathname.match(/^\/api\/orders\/([^/]+)\/save$/);
    if (req.method === 'POST' && sav) {
      const { status, data } = await paypal(`/v2/checkout/orders/${encodeURIComponent(sav[1])}/save`);
      return send(res, status, data);
    }

    // Orders v2: authorize (no request body needed once the buyer has approved)
    const auth = url.pathname.match(/^\/api\/orders\/([^/]+)\/authorize$/);
    if (req.method === 'POST' && auth) {
      const { status, data } = await paypal(`/v2/checkout/orders/${encodeURIComponent(auth[1])}/authorize`);
      return send(res, status, data);
    }

    // Payments v2: capture a prior authorization (authorize happens first, then capture)
    const capA = url.pathname.match(/^\/api\/authorizations\/([^/]+)\/capture$/);
    if (req.method === 'POST' && capA) {
      const { status, data } = await paypal(`/v2/payments/authorizations/${encodeURIComponent(capA[1])}/capture`, { final_capture: true });
      return send(res, status, data);
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(fs.readFileSync(path.join(here, 'public', 'index.html')));
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 500, { error: e.message }); }
}).listen(PORT, () => console.log(`POC server on http://localhost:${PORT} -> ${PAYPAL_API_BASE}`));
