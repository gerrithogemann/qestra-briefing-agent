// ============================================================
// ALEKSANDRA · Archive on Got It
// Called by PWA when user taps "Got it" on an insight item.
// Removes INBOX label from the Gmail thread (archives it).
// ============================================================

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { threadId } = req.body || {};
  if (!threadId) return res.status(400).json({ error: 'threadId required' });

  try {
    const googleToken = await getGoogleAccessToken();

    // Remove INBOX label — this archives the thread
    const archiveRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${googleToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
      }
    );

    if (!archiveRes.ok) {
      throw new Error(`Gmail archive failed: ${await archiveRes.text()}`);
    }

    console.log(`[archive] Archived thread ${threadId}`);
    return res.status(200).json({ success: true, threadId });

  } catch (err) {
    console.error('[archive] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
