const { json, getBearer, supabaseUser, supabaseAdmin } = require("../_lib/razorpay");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  try {
    const token = getBearer(req);
    if (!token) return json(res, 401, { error: "Sign in is required." });
    const user = await supabaseUser(token);
    if (!user || !user.id) return json(res, 401, { error: "Your session is invalid or expired." });
    const noteId = String((req.query || {}).note_id || "").trim();
    if (!noteId) return json(res, 400, { error: "note_id is required." });
    const rows = await supabaseAdmin(
      "marketplace_entitlements?select=id,note_id,granted_at&buyer_user_id=eq." +
      encodeURIComponent(user.id) + "&note_id=eq." + encodeURIComponent(noteId) + "&limit=1"
    );
    return json(res, 200, { entitled: Array.isArray(rows) && rows.length === 1 });
  } catch (error) {
    console.error("payment entitlement:", error.message);
    return json(res, 503, { error: "Could not confirm purchase access." });
  }
};
