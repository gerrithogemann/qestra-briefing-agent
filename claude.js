// ============================================================
// lib/claude.js — Calls Anthropic API to generate the briefing
// ============================================================

export async function generateBriefing({ emails, calendar, notionTasks }) {
  const today = new Date().toLocaleDateString('en-IE', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Europe/Dublin',
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: `You are a sharp executive assistant for a solo healthtech founder in Dublin, Ireland.
They are building Keeper (healthcare rota/scheduling SaaS) and TropiQ (tropical medicine learning app).
They are pre-launch on both products and actively doing investor prep.
Be direct, prioritised, and specific. No fluff. Irish timezone context.
Return ONLY valid JSON — no markdown, no explanation, no preamble.`,
      messages: [{
        role: 'user',
        content: `Today: ${today}

EMAIL DATA:
${JSON.stringify(emails, null, 2)}

CALENDAR:
${JSON.stringify(calendar, null, 2)}

NOTION HIGH PRIORITY TASKS:
${JSON.stringify(notionTasks, null, 2)}

Generate a morning briefing. Return ONLY this JSON structure:
{
  "headline": "one sharp sentence summarising the day",
  "priority_score": <1-10>,
  "top_3_tasks": [
    {"rank": 1, "task": "...", "source": "Email|Notion|Calendar", "why": "..."},
    {"rank": 2, "task": "...", "source": "Email|Notion|Calendar", "why": "..."},
    {"rank": 3, "task": "...", "source": "Email|Notion|Calendar", "why": "..."}
  ],
  "email_drafts": [
    {"to": "...", "subject": "...", "draft": "..."}
  ],
  "schedule_summary": "...",
  "recommended_focus_block": "...",
  "watch_out": "...",
  "qestra_spotlight": "one specific Qestra task with highest business impact today"
}`,
      }],
    }),
  });

  const data = await res.json();
  if (!data.content) throw new Error(`Claude API error: ${JSON.stringify(data)}`);

  const text = data.content.find(b => b.type === 'text')?.text || '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    throw new Error(`Failed to parse Claude response: ${text}`);
  }
}
