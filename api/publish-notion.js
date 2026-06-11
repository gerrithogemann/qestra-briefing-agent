// ============================================================
// ALEKSANDRA · Publish to Notion
// Called by PWA when user approves a Pavel draft item.
// Creates the Notion page and adds the page link to the
// corresponding task's Agent Notes field.
// ============================================================

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { briefingItemId } = req.body || {};
  if (!briefingItemId) return res.status(400).json({ error: "briefingItemId required" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const NOTION_TOKEN = process.env.NOTION_TOKEN;

  try {
    // Fetch the briefing item
    const itemRes = await fetch(
      `${SUPABASE_URL}/rest/v1/briefing_items?id=eq.${briefingItemId}`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    if (!itemRes.ok) throw new Error(`Failed to fetch briefing item: ${itemRes.status}`);
    const items = await itemRes.json();
    const item = items[0];
    if (!item) throw new Error(`Briefing item ${briefingItemId} not found`);

    const {
      output_type,
      page_title,
      parent_id,
      notion_task_id,
    } = item.source_data || {};

    if (output_type !== "notion-page") {
      return res.status(400).json({ error: "This item is not a Notion page draft" });
    }

    if (!parent_id) throw new Error("No parent_id in source_data");

    // Create the Notion page
    const content = item.draft || "";
    const lines = content.split("\n").filter(l => l.trim());
    const blocks = lines.map(line => {
      if (line.startsWith("# ")) return { object: "block", type: "heading_1", heading_1: { rich_text: [{ type: "text", text: { content: line.slice(2) } }] } };
      if (line.startsWith("## ")) return { object: "block", type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: line.slice(3) } }] } };
      if (line.startsWith("### ")) return { object: "block", type: "heading_3", heading_3: { rich_text: [{ type: "text", text: { content: line.slice(4) } }] } };
      if (line.startsWith("- ") || line.startsWith("* ")) return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ type: "text", text: { content: line.slice(2) } }] } };
      return { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: line } }] } };
    });

    // Create page (first 100 blocks)
    const createRes = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        parent: { page_id: parent_id },
        properties: {
          title: { title: [{ text: { content: page_title || "Untitled" } }] },
        },
        children: blocks.slice(0, 100),
      }),
    });

    if (!createRes.ok) throw new Error(`Notion page create failed: ${await createRes.text()}`);
    const notionPage = await createRes.json();
    const notionPageId = notionPage.id;
    const notionPageUrl = notionPage.url;

    // Append remaining blocks if any
    for (let i = 100; i < blocks.length; i += 100) {
      await fetch(`https://api.notion.com/v1/blocks/${notionPageId}/children`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({ children: blocks.slice(i, i + 100) }),
      });
    }

    console.log(`[publish-notion] Created page: ${page_title} (${notionPageId})`);

    // Update task Agent Notes with the Notion page link
    if (notion_task_id) {
      const today = new Date().toLocaleDateString("en-IE");
      const noteText = `Pavel: "${page_title}" published to Notion ${today}. Page: ${notionPageUrl}`;

      await fetch(`https://api.notion.com/v1/pages/${notion_task_id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({
          properties: {
            "Agent Notes": {
              rich_text: [{ type: "text", text: { content: noteText } }],
            },
          },
        }),
      });

      console.log(`[publish-notion] Updated task agent notes for ${notion_task_id}`);
    }

    return res.status(200).json({
      success: true,
      notionPageId,
      notionPageUrl,
    });

  } catch (err) {
    console.error("[publish-notion] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
