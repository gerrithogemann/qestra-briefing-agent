// ============================================================
// lib/notion.js — Reads tasks from Notion, writes briefing
// Uses Notion API with a simple Integration Token (easy setup)
// ============================================================

const NOTION_VERSION = '2022-06-28';
const TASK_DATABASE_ID = 'b5052d99b2294d2d82a95bc09a8cdca2'; // Qestra Task Tracker
const BRIEFINGS_PAGE_ID = '37284f83-15a2-81d1-897b-f334a6eca050'; // Morning Briefings page

function notionHeaders() {
  return {
    'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

// Fetch high-priority To Do tasks from Qestra Task Tracker
export async function fetchNotionTasks() {
  const res = await fetch(`https://api.notion.com/v1/databases/${TASK_DATABASE_ID}/query`, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({
      filter: {
        and: [
          { property: 'Status', select: { equals: 'To Do' } },
          { property: 'Priority', select: { equals: 'High' } },
        ],
      },
      sorts: [{ property: 'Product', direction: 'ascending' }],
      page_size: 10,
    }),
  });

  const data = await res.json();
  if (!data.results) throw new Error('Failed to fetch Notion tasks');

  const high_priority_tasks = data.results.map(page => ({
    task: page.properties.Task?.title?.[0]?.plain_text || '',
    product: page.properties.Product?.select?.name || '',
    tag: page.properties.Tag?.rich_text?.[0]?.plain_text || '',
  }));

  // Also get total count of all To Do tasks
  const countRes = await fetch(`https://api.notion.com/v1/databases/${TASK_DATABASE_ID}/query`, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({
      filter: { property: 'Status', select: { equals: 'To Do' } },
      page_size: 1,
    }),
  });
  const countData = await countRes.json();

  return {
    high_priority_tasks,
    total_high: high_priority_tasks.length,
    total_todo: countData.results?.length || 0,
  };
}

// Post the briefing as a new child page under Morning Briefings
export async function postBriefingToNotion({ briefing, emails, calendar, notionTasks }) {
  const today = new Date().toLocaleDateString('en-IE', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Europe/Dublin',
  });
  const dateStr = new Date().toLocaleDateString('en-IE', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Dublin',
  });

  // Build Notion block content
  const blocks = [
    // Headline callout
    {
      object: 'block', type: 'callout',
      callout: {
        rich_text: [{ type: 'text', text: { content: briefing.headline } }],
        icon: { emoji: '🌅' },
        color: 'green_background',
      },
    },
    // Priority score
    {
      object: 'block', type: 'paragraph',
      paragraph: {
        rich_text: [
          { type: 'text', text: { content: 'Priority Score: ' }, annotations: { bold: true } },
          { type: 'text', text: { content: `${briefing.priority_score}/10 · ${today}` } },
        ],
      },
    },
    { object: 'block', type: 'divider', divider: {} },

    // Top 3 Tasks
    { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '🎯 Top 3 Tasks Today' } }] } },
    ...(briefing.top_3_tasks || []).map(t => ({
      object: 'block', type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [
          { type: 'text', text: { content: `[${t.source}] ` }, annotations: { code: true } },
          { type: 'text', text: { content: `${t.task} — ${t.why}` } },
        ],
      },
    })),

    // Qestra Spotlight
    { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '🔬 Qestra Spotlight' } }] } },
    {
      object: 'block', type: 'quote',
      quote: { rich_text: [{ type: 'text', text: { content: briefing.qestra_spotlight || '' } }] },
    },

    // Email summary
    { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '📬 Email Summary' } }] } },
    {
      object: 'block', type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: `${emails.unread_count || 0} unread · ${emails.urgent?.length || 0} urgent · ${emails.tasks_from_email?.length || 0} tasks found` } }],
      },
    },
    ...(emails.tasks_from_email || []).map(t => ({
      object: 'block', type: 'to_do',
      to_do: {
        rich_text: [
          { type: 'text', text: { content: `${t.task}` }, annotations: { bold: true } },
          { type: 'text', text: { content: ` — from ${t.from}${t.due ? ' · ' + t.due : ''}` } },
        ],
        checked: false,
      },
    })),

    // Schedule
    { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '📅 Schedule' } }] } },
    {
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: briefing.schedule_summary || '' } }] },
    },
    ...(calendar.events || []).map(e => ({
      object: 'block', type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [
          { type: 'text', text: { content: `${e.time} ` }, annotations: { bold: true } },
          { type: 'text', text: { content: e.title } },
        ],
      },
    })),

    { object: 'block', type: 'divider', divider: {} },

    // Watch out + Focus block (side by side using columns isn't supported in API, so sequential)
    { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: '⚠️ Watch Out' } }] } },
    { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: briefing.watch_out || '' } }] } },
    { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: '💡 Recommended Focus Block' } }] } },
    { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: briefing.recommended_focus_block || '' } }] } },

    // Draft replies
    ...(briefing.email_drafts?.length ? [
      { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '✉️ Draft Replies' } }] } },
      ...(briefing.email_drafts).map(d => ({
        object: 'block', type: 'toggle',
        toggle: {
          rich_text: [
            { type: 'text', text: { content: `To: ${d.to} · Re: ${d.subject}` }, annotations: { bold: true } },
          ],
          children: [{
            object: 'block', type: 'paragraph',
            paragraph: { rich_text: [{ type: 'text', text: { content: d.draft } }] },
          }],
        },
      })),
    ] : []),

    // Footer
    { object: 'block', type: 'divider', divider: {} },
    {
      object: 'block', type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: 'Generated by Qestra Morning Briefing Agent' }, annotations: { italic: true, color: 'gray' } }],
      },
    },
  ];

  // Create the page
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({
      parent: { page_id: BRIEFINGS_PAGE_ID },
      properties: { title: [{ text: { content: `🌅 ${dateStr}` } }] },
      children: blocks,
    }),
  });

  const data = await res.json();
  if (!data.url) throw new Error(`Notion page creation failed: ${JSON.stringify(data)}`);
  return data.url;
}
