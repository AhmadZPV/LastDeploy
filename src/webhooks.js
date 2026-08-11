const WEBHOOK_FIELDS = {
  adressen: 'WebhookAdressen',
  aufgaben: 'WebhookAufgaben',
  notizen: 'WebhookNotizen',
  termine: 'WebhookTermine',
};

function encodeQuery(record) {
  return Object.entries(record || {})
    .filter(([, value]) => value != null && typeof value !== 'object')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

export async function dispatchWebhook({ prisma, entity, record, req, fetchImpl = fetch, timeoutMs = 5000, retries = 2 }) {
  const field = WEBHOOK_FIELDS[String(entity || '').toLowerCase()];
  if (!field || !prisma?.einstellungen) return { sent: false, skipped: true, reason: 'unsupported entity' };
  const team = req?.session?.user?.Team || record?.Team || 'Team';
  const settings = await prisma.einstellungen.findFirst({ where: { Team: team }, select: { [field]: true } });
  const base = String(settings?.[field] || '').trim();
  if (!base) return { sent: false, skipped: true, reason: 'webhook not configured' };
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Webhook URL must use HTTP or HTTPS');
  const query = encodeQuery({ ...record, Team: team });
  url.search = url.search ? `${url.search.slice(1)}&${query}` : query;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal });
      if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
      return { sent: true, status: response.status, attempts: attempt + 1, url: url.toString() };
    } catch (error) { lastError = error; }
    finally { clearTimeout(timer); }
  }
  throw lastError || new Error('Webhook failed');
}

export { WEBHOOK_FIELDS, encodeQuery };
