// ============================================================
// Qestra Morning Briefing Agent — Single file, no dependencies
// ============================================================

const TASK_DATABASE_ID = 'b5052d99b2294d2d82a95bc09a8cdca2';
const BRIEFINGS_PAGE_ID = '37284f83-15a2-81d1-897b-f334a6eca050';

// ── Google OAuth ──────────────────────────────────────────────
async function getGoogleToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Google token failed: ' + JSON.stringify(data));
  return data.access_token;
}

// ── Gmail ─────────────────────────────────────────────────────
async function fetchGmail(token) {
  const base = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const headers = { Authorization: `Bearer ${token}` };

  async function search(query, max = 15) {
    const r = await fetch(`${base}/messages?q=${encodeURIComponent(query)}&maxResults=${max}`, { headers });
    const d = await r.json();
    return d.messages || [];
  }

  async function getMessage(id) {
    const r = await fetch(`${base}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, { headers });
    return r.json();
  }

  function header(msg, name) {
    return msg.payload?.headers?.find(h => h.name === name)?.value || '';
  }

  const [unread, important, recent] = await Promise.all([
    search('is:unread', 15),
    search('is:starred OR label:important is:unread', 10),
    search('newer_than:2d', 20),
  ]);

  const seen = new Set();
  const all = [...unread, ...important, ...recent].filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  const messages = await Promise.all(all.slice(0, 20).map(m => getMessage(m.id)));

  const urgent = [], action_needed = [], fyi = [], tasks_from_email = [];
  const actionRe = /reply|respond|confirm|review|approve|deadline|urgent|asap|action|required|reminder|follow.?up|due|please|request|invoice|contract/i;

  for (const msg of messages) {
    const from = header(msg, 'From');
    const subject = header(msg, 'Subject');
    const snippet = msg.snippet || '';
    const isUnread = msg.labelIds?.includes('UNREAD');
    const isImportant = msg.labelIds?.includes('IMPORTANT') || msg.labelIds?.includes('STARRED');
    const hasAction = actionRe.test(subject) || actionRe.test(snippet);

    if (isImportant && isUnread) urgent.push({ from, subject, summary: snippet.slice(0, 100) });
    else if (isUnread && hasAction) action_needed.push({ from, subject });
    else fyi.push({ from, subject });

    if (hasAction) tasks_from_email.push({ task: subject, from, due: '' });
  }

  return { unread_count: unread.length, urgent: urgent.slice(0,5), action_needed: action_needed.slice(0,8), fyi: fyi.slice(0,5), tasks_from_email: tasks_from_email.slice(0,8) };
}

// ── Calendar ──────────────────────────────────────────────────
async function fetchCalendar(token) {
  const now = new Date();
  const start = new Date(now); start.setHours(0,0,0,0);
  const end = new Date(now); end.setHours(23,59,59,999);

  const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events?' + new URLSearchParams({
    timeMin: start.toISOString(), timeMax: end.toISOString(),
    singleEvents: 'true', orderBy: 'startTime', maxResults: '15',
  });

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  const items = data.items || [];

  const events = items.map(e => {
    const s = e.start?.dateTime || e.start?.date || '';
    const time = s ? new Date(s).toLocaleTimeString('en-IE', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Dublin' }) : 'All day';
    return { time, title: e.summary || 'Untitled' };
  });

  return { event_count: events.length, events, first_meeting: events[0]?.time || 'None' };
}

// ── Notion Tasks ──────────────────────────────────────────────
async function fetchNotionTasks() {
  const res = await fetch(`https://api.notion.com/v1/databases/${TASK_DATABASE_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: { and: [
        { property: 'Status', select: { equals: 'To Do' } },
        { property: 'Priority', select: { equals: 'High' } },
      ]},
      page_size: 10,
    }),
  });
  const data = await res.json();
  if (!data.results) throw new Error('Notion query failed: ' + JSON.stringify(data));

  const tasks = data.results.map(p => ({
    task: p.properties.Task?.title?.[0]?.plain_text || '',
    product: p.properties.Product?.select?.name || '',
  }));

  return { high_priority_tasks: tasks, total_high: tasks.length };
}

// ── Claude ────────────────────────────────────────────────────
async function generateBriefing(emails, calendar, notionTasks) {
  const today = new Date().toLocaleDateString('en-IE', {
    weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'Europe/Dublin'
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
They are building Keeper (healthcare rota SaaS) and TropiQ (tropical medicine learning app).
Be direct, prioritised, specific. No fluff. Return ONLY valid JSON — no markdown, no preamble.`,
      messages: [{ role: 'user', content: `Today: ${today}
EMAIL: ${JSON.stringify(emails)}
CALENDAR: ${JSON.stringify(calendar)}
NOTION TASKS: ${JSON.stringify(notionTasks)}

Return ONLY this JSON:
{
  "headline": "one sharp sentence summarising the day",
  "priority_score": <1-10>,
  "top_3_tasks": [{"rank":1,"task":"...","source":"Email|Notion|Calendar","why":"..."}],
  "email_drafts": [{"to":"...","subject":"...","draft":"..."}],
  "schedule_summary": "...",
  "recommended_focus_block": "...",
  "watch_out": "...",
  "qestra_spotlight": "highest-impact Qestra task today"
}` }],
    }),
  });

  const data = await res.json();
  const text = data.content?.find(b => b.type === 'text')?.text || '{}';
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); }
  catch { throw new Error('Claude parse failed: ' + text.slice(0, 200)); }
}

// ── Post to Notion ────────────────────────────────────────────
async function postToNotion(briefing, emails, calendar) {
  const dateStr = new Date().toLocaleDateString('en-IE', {
    day:'2-digit', month:'2-digit', year:'numeric', timeZone:'Europe/Dublin'
  });

  const t = s => [{ type:'text', text:{ content: s } }];
  const tb = s => [{ type:'text', text:{ content: s }, annotations:{ bold:true } }];

  const blocks = [
    { object:'block', type:'callout', callout:{ rich_text: t(briefing.headline || ''), icon:{ emoji:'🌅' }, color:'green_background' }},
    { object:'block', type:'paragraph', paragraph:{ rich_text:[
      { type:'text', text:{ content:'Priority Score: ' }, annotations:{ bold:true } },
      { type:'text', text:{ content:`${briefing.priority_score}/10` } },
    ]}},
    { object:'block', type:'divider', divider:{} },

    { object:'block', type:'heading_2', heading_2:{ rich_text: t('🎯 Top 3 Tasks') }},
    ...(briefing.top_3_tasks || []).map(task => ({
      object:'block', type:'bulleted_list_item', bulleted_list_item:{ rich_text:[
        { type:'text', text:{ content:`[${task.source}] ` }, annotations:{ code:true } },
        { type:'text', text:{ content:`${task.task} — ${task.why}` } },
      ]},
    })),

    { object:'block', type:'heading_2', heading_2:{ rich_text: t('🔬 Qestra Spotlight') }},
    { object:'block', type:'quote', quote:{ rich_text: t(briefing.qestra_spotlight || '') }},

    { object:'block', type:'heading_2', heading_2:{ rich_text: t('📬 Email Tasks') }},
    ...(emails.tasks_from_email || []).map(task => ({
      object:'block', type:'to_do', to_do:{ rich_text: t(`${task.task} — from ${task.from}`), checked:false },
    })),

    { object:'block', type:'heading_2', heading_2:{ rich_text: t('📅 Schedule') }},
    { object:'block', type:'paragraph', paragraph:{ rich_text: t(briefing.schedule_summary || '') }},
    ...(calendar.events || []).map(e => ({
      object:'block', type:'bulleted_list_item', bulleted_list_item:{ rich_text:[
        { type:'text', text:{ content:`${e.time}  ` }, annotations:{ bold:true } },
        { type:'text', text:{ content: e.title } },
      ]},
    })),

    { object:'block', type:'divider', divider:{} },
    { object:'block', type:'heading_3', heading_3:{ rich_text: t('⚠️ Watch Out') }},
    { object:'block', type:'paragraph', paragraph:{ rich_text: t(briefing.watch_out || '') }},
    { object:'block', type:'heading_3', heading_3:{ rich_text: t('💡 Focus Block') }},
    { object:'block', type:'paragraph', paragraph:{ rich_text: t(briefing.recommended_focus_block || '') }},

    ...(briefing.email_drafts?.length ? [
      { object:'block', type:'heading_2', heading_2:{ rich_text: t('✉️ Draft Replies') }},
      ...(briefing.email_drafts).map(d => ({
        object:'block', type:'toggle', toggle:{
          rich_text: tb(`To: ${d.to} · Re: ${d.subject}`),
          children: [{ object:'block', type:'paragraph', paragraph:{ rich_text: t(d.draft) }}],
        },
      })),
    ] : []),

    { object:'block', type:'divider', divider:{} },
    { object:'block', type:'paragraph', paragraph:{ rich_text:[
      { type:'text', text:{ content:'Generated by Qestra Morning Briefing Agent' }, annotations:{ italic:true, color:'gray' } }
    ]}},
  ];

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { page_id: BRIEFINGS_PAGE_ID },
      properties: { title: [{ text:{ content:`🌅 ${dateStr}` } }] },
      children: blocks,
    }),
  });

  const data = await res.json();
  if (!data.url) throw new Error('Notion post failed: ' + JSON.stringify(data));
  return data.url;
}

// ── Main handler ──────────────────────────────────────────────
export default async function handler(req, res) {
  const isVercelCron = req.headers['user-agent']?.includes('vercel-cron');
  const isManual = req.headers['x-trigger-secret'] === process.env.TRIGGER_SECRET;

  if (!isVercelCron && !isManual) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('🌅 Briefing agent starting...');
    const googleToken = await getGoogleToken();

    const [emails, calendar, notionTasks] = await Promise.all([
      fetchGmail(googleToken),
      fetchCalendar(googleToken),
      fetchNotionTasks(),
    ]);

    console.log(`✉️ ${emails.unread_count} unread, ${emails.tasks_from_email?.length} tasks`);
    console.log(`📅 ${calendar.event_count} events`);
    console.log(`📝 ${notionTasks.total_high} high priority tasks`);

    const briefing = await generateBriefing(emails, calendar, notionTasks);
    console.log('🧠 Briefing generated');

    const notionUrl = await postToNotion(briefing, emails, calendar);
    console.log('✅ Posted:', notionUrl);

    return res.status(200).json({ success: true, notionUrl });
  } catch (err) {
    console.error('❌', err.message);
    return res.status(500).json({ error: err.message });
  }
}
