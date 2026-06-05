// ============================================================
// ALEKSANDRA · Improve Draft
// Called by PWA when user taps "Improve" on a draft item.
// Rewrites the draft via Claude — API key stays server-side.
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { draft, instruction } = req.body || {};
  if (!draft) return res.status(400).json({ error: 'draft required' });
  if (!instruction) return res.status(400).json({ error: 'instruction required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 500,
        system: `You are helping Gerrit rewrite email drafts.
His voice: warm, natural, first names always, short is better than long, never corporate.
Return ONLY the rewritten email body. No explanation, no subject line, no sign-off.`,
        messages: [{
          role: 'user',
          content: `Original draft:\n${draft}\n\nInstruction: ${instruction}\n\nRewrite it.`,
        }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Claude API error');
    }

    const data = await response.json();
    const result = data.content?.[0]?.text?.trim();
    if (!result) throw new Error('No response from Claude');

    console.log(`[improve] Rewrote draft (${instruction})`);
    return res.status(200).json({ result });

  } catch (err) {
    console.error('[improve] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
