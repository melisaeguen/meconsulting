// api/crm.js
// Vercel serverless — proxy entre el CRM y Google Apps Script

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!APPS_SCRIPT_URL) {
    return res.status(500).json({ error: 'APPS_SCRIPT_URL no configurada' });
  }

  try {
    if (req.method === 'GET') {
      // Exponer la URL del Apps Script para que el browser llame directo
      // (evita problemas de redirección server-side con Google)
      if (req.query.action === 'getScriptUrl') {
        return res.status(200).json({ url: APPS_SCRIPT_URL });
      }
      // Proxy GET → Apps Script
      const params   = new URLSearchParams(req.query).toString();
      const url      = `${APPS_SCRIPT_URL}${params ? '?' + params : ''}`;
      const upstream = await fetch(url, { redirect: 'follow' });
      const text     = await upstream.text();
      console.log('Apps Script GET response:', upstream.status, text.substring(0, 500));
      try {
        return res.status(200).json(JSON.parse(text));
      } catch {
        return res.status(200).json({ raw: text });
      }
    }

    if (req.method === 'POST') {
      // Proxy POST → Apps Script (actualizar CRM, crear Google Doc)
      const upstream = await fetch(APPS_SCRIPT_URL, {
        method:   'POST',
        headers:  { 'Content-Type': 'application/json' },
        body:     JSON.stringify(req.body),
        redirect: 'follow',
      });
      const text = await upstream.text();
      try {
        return res.status(200).json(JSON.parse(text));
      } catch {
        return res.status(200).json({ ok: true });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('CRM proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
