// ============================================================
// lib/calendar.js — Fetches today's Google Calendar events
// Reuses the same OAuth token flow as Gmail
// ============================================================

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

async function getAccessToken() {
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
  if (!data.access_token) throw new Error('Failed to get Google access token');
  return data.access_token;
}

export async function fetchCalendar() {
  const token = await getAccessToken();

  // Today's range in Dublin timezone (UTC+1 in summer, UTC in winter)
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const url = `${CALENDAR_BASE}/calendars/primary/events?` + new URLSearchParams({
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '20',
  });

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  const items = data.items || [];

  const events = items.map(e => {
    const start = e.start?.dateTime || e.start?.date || '';
    const end = e.end?.dateTime || e.end?.date || '';
    const startTime = start ? new Date(start).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Dublin' }) : 'All day';
    const endTime = end ? new Date(end).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Dublin' }) : '';
    const durationMs = start && end ? new Date(end) - new Date(start) : 0;
    const duration_mins = Math.round(durationMs / 60000);

    return {
      time: startTime,
      end_time: endTime,
      title: e.summary || 'Untitled',
      duration_mins,
      location: e.location || '',
      isOnline: !!(e.hangoutLink || e.conferenceData),
    };
  });

  // Calculate free blocks between events
  const free_blocks = [];
  for (let i = 0; i < events.length - 1; i++) {
    free_blocks.push({
      start: events[i].end_time,
      end: events[i + 1].time,
    });
  }

  const first_meeting = events[0]?.time || 'No meetings today';

  return {
    event_count: events.length,
    events,
    first_meeting,
    free_blocks,
  };
}
