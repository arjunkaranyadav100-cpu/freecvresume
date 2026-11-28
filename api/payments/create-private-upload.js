const { json, env, getBearer, supabaseUser, supabaseAdmin } = require("../_lib/razorpay");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const token = getBearer(req);
    if (!token) return json(res, 401, { error: "Sign in is required." });
    const user = await supabaseUser(token);
    if (!user || !user.id) return json(res, 401, { error: "Your session is invalid or expired." });
    const noteId = String((req.body || {}).note_id || "").trim();
    if (!/^custom-note-[a-zA-Z0-9-]{8,100}$/.test(noteId)) return json(res, 400, { error: "Invalid note_id." });

    const rows = await supabaseAdmin("study_notes?select=id,creator_id,price& id=eq." + encodeURIComponent(noteId) + "&limit=1".replace(" ", ""));
    if (!Array.isArray(rows) || !rows.length || rows[0].creator_id !== user.id) return json(res, 403, { error: "You can only upload a PDF for your own note." });
    if (Number(rows[0].price) <= 0) return json(res, 400, { error: "This endpoint is only for paid notes." });

    const path = user.id + "/" + noteId + ".pdf";
    const response = await fetch(env("SUPABASE_URL") + "/storage/v1/object/upload/sign/paid-notes-private/" + path.split("/").map(encodeURIComponent).join("/"), {
      method: "POST",
      headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ upsert: true })
    });
    const result = await response.json();
    if (!response.ok || !result.token) return json(res, 502, { error: "Could not prepare private PDF upload." });
    return json(res, 200, { bucket: "paid-notes-private", path, token: result.token });
  } catch (error) {
    console.error("private upload ticket:", error.message);
    return json(res, 503, { error: "Secure PDF upload is unavailable." });
  }
};
