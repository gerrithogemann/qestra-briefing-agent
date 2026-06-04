// ============================================================
// ALEKSANDRA · Send on Approval
// Called by PWA when user approves (or edits + approves) a
// Masha email draft. Sends via Gmail REST API directly.
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const SIGNATURE_PLAIN = `\n\nGerrit Högemann\n@: gerrithogemann@gmail.com\n✆: +353 89 240 5889`;

const SIGNATURE_HTML = `
<br><br>
<span style="font-family: 'Aptos', Arial, sans-serif; font-size: 12pt; color: #000000;">
  Gerrit Högemann<br>
  <a href="mailto:gerrithogemann@gmail.com" style="color: #000000; text-decoration: none;">@: gerrithogemann@gmail.com</a><br>
  ✆: +353 89 240 5889
</span>`;

function buildHtmlEmail(plainTextBody) {
  const escaped = plainTextBody
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const paragraphs = escaped
    .split(/\n\n+/)
    .map(p => `<p style="margin: 0 0 12px 0;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#fff;">
<div style="font-family:'Aptos',Arial,sans-serif;font-size:12pt;color:#000;line-height:1.5;max-width:680px;padding:16px;">
${paragraphs}
${SIGNATURE_HTML}
</div></body></html>`;
}

async function getGoogleAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('No access token in Google response');
  return data.access_token;
}

async function sendEmailViaGmail(accessToken, { to, subject, plainBody, htmlBody, threadId }) {
  const boundary = `boundary_${Date.now()}_aleksandra`;
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    plainBody,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    htmlBody,
    ``,
    `--${boundary}--`,
  ].join('\r\n');

  const encoded = Buffer.from(message).toString('base64url');
  const payload = { raw: encoded };
  if (threadId) payload.threadId = threadId;

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${await res.text()}`);
  return res.json();
}

export default async function handler(req, res) {
  // CORS for PWA
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { briefingItemId, editedDraft } = req.body || {};
  if (!briefingItemId) return res.status(400).json({ error: 'briefingItemId required' });

  try {
    // 1. Fetch the briefing item
    const sbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/briefing_items?id=eq.${briefingItemId}`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    const items = await sbRes.json();
    const item = items[0];
    if (!item) return res.status(404).json({ error: 'Briefing item not found' });

    const { sender, sender_name, subject, thread_id, html_body } = item.source_data || {};
    if (!sender) return res.status(400).json({ error: 'No sender in source_data — cannot send' });

    // 2. Resolve plain + HTML bodies
    let plainBody, htmlBody;
    if (editedDraft) {
      // Edited draft arrives without signature — add it
      plainBody = editedDraft.trimEnd() + SIGNATURE_PLAIN;
      htmlBody  = buildHtmlEmail(editedDraft.trimEnd());
    } else {
      plainBody = item.draft;
      // Use pre-generated HTML if available, else build from plain
      const bodyWithoutSig = item.draft?.replace(SIGNATURE_PLAIN, '').trimEnd() || '';
      htmlBody = html_body || buildHtmlEmail(bodyWithoutSig);
    }

    if (!plainBody) return res.status(400).json({ error: 'No draft body — cannot send' });

    // 3. Get Google access token
    const googleToken = await getGoogleAccessToken();

    // 4. Send
    await sendEmailViaGmail(googleToken, {
      to: sender,
      subject: subject?.startsWith('Re:') ? subject : `Re: ${subject}`,
      plainBody,
      htmlBody,
      threadId: thread_id,
    });

    console.log(`[send] Sent to ${sender} re: ${subject}`);

    return res.status(200).json({ success: true, sentTo: sender, subject });

  } catch (err) {
    console.error('[send] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
