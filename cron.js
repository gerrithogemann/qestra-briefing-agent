// ============================================================
// Qestra Morning Briefing Agent — Vercel Cron Endpoint
// Runs daily at 6am Dublin time (5am UTC)
// ============================================================

import { fetchGmail } from '../lib/gmail.js';
import { fetchCalendar } from '../lib/calendar.js';
import { fetchNotionTasks } from '../lib/notion.js';
import { generateBriefing } from '../lib/claude.js';
import { postBriefingToNotion } from '../lib/notion.js';

export const config = {
  maxDuration: 60, // seconds — Vercel allows up to 60s on Hobby
};

export default async function handler(req, res) {
  // Security: only allow Vercel cron calls (or manual trigger with secret)
  const isVercelCron = req.headers['user-agent']?.includes('vercel-cron');
  const isManualTrigger = req.headers['x-trigger-secret'] === process.env.TRIGGER_SECRET;

  if (!isVercelCron && !isManualTrigger) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('🌅 Qestra Morning Briefing Agent starting...');

  try {
    // ── 1. Fetch data from all sources in parallel ──
    console.log('📡 Fetching Gmail, Calendar, and Notion tasks...');
    const [emails, calendar, notionTasks] = await Promise.all([
      fetchGmail(),
      fetchCalendar(),
      fetchNotionTasks(),
    ]);

    console.log(`✉️  Emails: ${emails.unread_count} unread, ${emails.tasks_from_email?.length} tasks`);
    console.log(`📅 Calendar: ${calendar.event_count} events today`);
    console.log(`📝 Notion: ${notionTasks.total_high} high-priority tasks`);

    // ── 2. Generate briefing with Claude ──
    console.log('🧠 Generating briefing with Claude...');
    const briefing = await generateBriefing({ emails, calendar, notionTasks });

    // ── 3. Post to Notion ──
    console.log('📄 Posting to Notion...');
    const notionUrl = await postBriefingToNotion({ briefing, emails, calendar, notionTasks });

    console.log(`✅ Briefing posted: ${notionUrl}`);
    return res.status(200).json({ success: true, notionUrl });

  } catch (error) {
    console.error('❌ Briefing agent failed:', error);
    return res.status(500).json({ error: error.message });
  }
}
