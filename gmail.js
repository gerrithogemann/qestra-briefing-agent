// ============================================================
// lib/gmail.js — Fetches and categorises emails
// Uses Gmail REST API with OAuth refresh token
// ============================================================

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Exchange refresh token for a fresh access token
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

// Fetch a list of message IDs matching a query
async function searchMessages(token, query, maxResults = 10) {
  const url = `${GMAIL_BASE}/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return data.messages || [];
}

// Fetch full message details for a message ID
async function getMessage(token, id) {
  const url = `${GMAIL_BASE}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

// Extract header value from Gmail message
function getHeader(msg, name) {
  return msg.payload?.headers?.find(h => h.name === name)?.value || '';
}

// Main export
export async function fetchGmail() {
  const token = await getAccessToken();

  // Run 3 searches in parallel: unread, starred/important, last 48h
  const [unreadIds, importantIds, recentIds] = await Promise.all([
    searchMessages(token, 'is:unread', 15),
    searchMessages(token, 'is:starred OR label:important is:unread', 10),
    searchMessages(token, 'newer_than:2d', 20),
  ]);

  // Deduplicate by message ID
  const allIds = [...new Map(
    [...unreadIds, ...importantIds, ...recentIds].map(m => [m.id, m])
  ).values()];

  // Fetch full details for each (limit to 25 to stay within time budget)
  const messages = await Promise.all(
    allIds.slice(0, 25).map(m => getMessage(token, m.id))
  );

  // Categorise messages
  const urgent = [];
  const action_needed = [];
  const fyi = [];
  const tasks_from_email = [];

  for (const msg of messages) {
    const from = getHeader(msg, 'From');
    const subject = getHeader(msg, 'Subject');
    const snippet = msg.snippet || '';
    const isUnread = msg.labelIds?.includes('UNREAD');
    const isImportant = msg.labelIds?.includes('IMPORTANT') || msg.labelIds?.includes('STARRED');

    // Simple heuristics to detect tasks/action items in subject/snippet
    const actionKeywords = /reply|respond|confirm|review|approve|deadline|urgent|asap|action|required|reminder|follow.?up|due|please|request|invoice|contract|meeting/i;
    const hasAction = actionKeywords.test(subject) || actionKeywords.test(snippet);

    const emailEntry = { from, subject, summary: snippet.slice(0, 120) };

    if (isImportant && isUnread) {
      urgent.push({ ...emailEntry, action: 'Reply needed' });
    } else if (isUnread && hasAction) {
      action_needed.push({ ...emailEntry, action: 'Review and action' });
    } else {
      fyi.push({ from, subject });
    }

    // Extract as task if it looks like a request
    if (hasAction) {
      tasks_from_email.push({
        task: subject,
        from,
        due: snippet.match(/by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[\/\-]\d{1,2})/i)?.[0] || '',
      });
    }
  }

  return {
    unread_count: unreadIds.length,
    urgent: urgent.slice(0, 5),
    action_needed: action_needed.slice(0, 8),
    fyi: fyi.slice(0, 5),
    tasks_from_email: tasks_from_email.slice(0, 8),
  };
}
