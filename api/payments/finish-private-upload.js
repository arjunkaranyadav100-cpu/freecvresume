const { json, getBearer, supabaseUser, supabaseAdmin } = require("../_lib/razorpay");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const token = getBearer(req);
    if (!token) return json(res, 401, { error: "Sign in is required." });
    const user = await supabaseUser(token);
    if (!user || !user.id) return json(res, 401, { error: "Your session is invalid or expired." });
    const noteId = String((req.body || {}).note_id || "").trim();
    const path = user.id + "/" + noteId + ".pdf";
    const rows = await supabaseAdmin("study_notes?select=id,creator_id,price&id=eq." + encodeURIComponent(noteId) + "&limit=1");
    if (!Array.isArray(rows) || !rows.length || rows[0].creator_id !== user.id || Number(rows[0].price) <= 0) return json(res, 403, { error: "Note ownership check failed." });

    const check = await fetch(process.env.SUPABASE_URL + "/storage/v1/object/info/paid-notes-private/" + path.split("/").map(encodeURIComponent).join("/"), {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY }
    });
    if (!check.ok) return json(res, 409, { error: "Uploaded PDF could not be verified in private storage." });
    await supabaseAdmin("study_notes?id=eq." + encodeURIComponent(noteId), {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ storage_path: path, url: "" })
    });
    return json(res, 200, { saved: true });
  } catch (error) {
    console.error("finish private upload:", error.message);
    return json(res, 503, { error: "Could not finalize private PDF upload." });
  }
};
