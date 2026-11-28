const { json, env, getBearer, supabaseUser, supabaseAdmin } = require("../_lib/razorpay");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  try {
    const token = getBearer(req);
    if (!token) return json(res, 401, { error: "Sign in is required." });
    const user = await supabaseUser(token);
    if (!user || !user.id) return json(res, 401, { error: "Your session is invalid or expired." });
    const noteId = String((req.query || {}).note_id || "").trim();
    if (!noteId) return json(res, 400, { error: "note_id is required." });

    const grants = await supabaseAdmin("marketplace_entitlements?select=id&buyer_user_id=eq." + encodeURIComponent(user.id) + "&note_id=eq." + encodeURIComponent(noteId) + "&limit=1");
    if (!Array.isArray(grants) || !grants.length) return json(res, 403, { error: "Purchase access is required." });
    const notes = await supabaseAdmin("study_notes?select=storage_path&id=eq." + encodeURIComponent(noteId) + "&limit=1");
    const path = notes && notes[0] && notes[0].storage_path;
    if (!path || path.split("/").length !== 2 || !/^[0-9a-f-]{36}$/.test(path.split("/")[0]) || path.split("/")[1] !== noteId + ".pdf") return json(res, 404, { error: "Private PDF is not available." });

    const response = await fetch(env("SUPABASE_URL") + "/storage/v1/object/sign/paid-notes-private/" + path.split("/").map(encodeURIComponent).join("/"), {
      method: "POST",
      headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 120 })
    });
    const signed = await response.json();
    if (!response.ok || !signed.signedURL) return json(res, 502, { error: "Could not create a secure PDF link." });
    const base = env("SUPABASE_URL");
    const url = signed.signedURL.startsWith("http") ? signed.signedURL : base + "/storage/v1" + signed.signedURL;
    return json(res, 200, { url, expires_in: 120 });
  } catch (error) {
    console.error("private download:", error.message);
    return json(res, 503, { error: "Secure PDF download is unavailable." });
  }
};
