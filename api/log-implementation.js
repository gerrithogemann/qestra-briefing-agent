// ============================================================
// ALEKSANDRA · Log Implementation
// Called by PWA when user approves an Aleksei briefing item.
// Writes a memory row so Aleksei knows this has been implemented
// and won't suggest it again.
// ============================================================

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { briefingItemId, title, summary, product } = req.body || {};
  if (!briefingItemId) return res.status(400).json({ error: "briefingItemId required" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    const today = new Date().toLocaleDateString("en-IE");
    const entity = product || "Keeper";
    const context = `Implemented ${today}: ${title || "prompt spec"}. ${summary || ""}`.trim();

    // Upsert into memory — entity/category pair is product + "implemented"
    // Using a timestamp suffix on entity to allow multiple entries per product
    const res2 = await fetch(
      `${SUPABASE_URL}/rest/v1/memory?on_conflict=entity,category`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          entity: `${entity}-${briefingItemId.slice(0, 8)}`,
          category: "implemented",
          context,
          source: "aleksei",
          confidence: 1.0,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    if (!res2.ok) throw new Error(`Memory write failed: ${await res2.text()}`);

    console.log(`[log-implementation] Logged: ${context}`);
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("[log-implementation] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
