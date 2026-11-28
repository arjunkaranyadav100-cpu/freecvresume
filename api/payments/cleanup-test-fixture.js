const { json, env, getBearer, supabaseUser, supabaseAdmin } = require("../_lib/razorpay");

module.exports = async function handler(req, res) {
  if (process.env.VERCEL_ENV !== "preview") return json(res, 404, { error: "Preview-only endpoint." });
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const token = getBearer(req);
    if (!token) return json(res, 401, { error: "Admin sign-in is required." });
    const user = await supabaseUser(token);
    if (!user || !user.id) return json(res, 401, { error: "Admin session is invalid or expired." });
    const profiles = await supabaseAdmin("profiles?select=id,role&id=eq." + encodeURIComponent(user.id) + "&limit=1");
    if (!Array.isArray(profiles) || !profiles.length || profiles[0].role !== "admin") return json(res, 403, { error: "Admin permission is required." });

    const noteId = String((req.body || {}).note_id || "");
    if (!/^custom-note-fcvtest-[a-f0-9]{14}$/.test(noteId)) return json(res, 400, { error: "Invalid test fixture ID." });
    const notes = await supabaseAdmin("study_notes?select=id,title,creator_id,storage_path,moderation_note,category&id=eq." + encodeURIComponent(noteId) + "&limit=1");
    if (!Array.isArray(notes) || !notes.length || !String(notes[0].title || "").startsWith("[TEST ONLY]") || notes[0].category !== "_chunk") {
      return json(res, 404, { error: "A matching hidden test fixture was not found; nothing was deleted." });
    }
    const note = notes[0];
    const orders = await supabaseAdmin("marketplace_orders?select=id,razorpay_order_id&note_id=eq." + encodeURIComponent(noteId));
    const orderIds = (orders || []).map(o => o.id);
    const razorpayOrderIds = (orders || []).map(o => o.razorpay_order_id);
    const events = await supabaseAdmin("marketplace_webhook_events?select=event_id,payload&limit=1000");
    const eventIds = (events || []).filter(event => {
      const p = event.payload || {};
      const orderId = p.order_id || (p.payload && p.payload.payment && p.payload.payment.entity && p.payload.payment.entity.order_id);
      return razorpayOrderIds.includes(orderId);
    }).map(event => event.event_id);

    for (const eventId of eventIds) {
      await supabaseAdmin("marketplace_webhook_events?event_id=eq." + encodeURIComponent(eventId), { method: "DELETE" });
    }
    for (const orderId of orderIds) {
      await supabaseAdmin("creator_ledger?order_id=eq." + encodeURIComponent(orderId), { method: "DELETE" });
    }
    await supabaseAdmin("marketplace_entitlements?note_id=eq." + encodeURIComponent(noteId), { method: "DELETE" });
    await supabaseAdmin("marketplace_orders?note_id=eq." + encodeURIComponent(noteId), { method: "DELETE" });
    await supabaseAdmin("marketplace_products?id=eq." + encodeURIComponent(noteId), { method: "DELETE" });
    if (note.storage_path) {
      const remove = await fetch(env("SUPABASE_URL") + "/storage/v1/object/paid-notes-private/" + note.storage_path.split("/").map(encodeURIComponent).join("/"), {
        method: "DELETE",
        headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY") }
      });
      if (!remove.ok && remove.status !== 404) throw new Error("Private test PDF cleanup failed.");
    }
    await supabaseAdmin("study_notes?id=eq." + encodeURIComponent(noteId), { method: "DELETE" });
    const buyerMatch = String(note.moderation_note || "").match(/^fcv_test_fixture_buyer:([0-9a-f-]{36})$/i);
    if (buyerMatch) {
      const removeBuyer = await fetch(env("SUPABASE_URL") + "/auth/v1/admin/users/" + encodeURIComponent(buyerMatch[1]), {
        method: "DELETE",
        headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY") }
      });
      if (!removeBuyer.ok && removeBuyer.status !== 404) throw new Error("Temporary test buyer cleanup failed.");
    }
    return json(res, 200, {
      cleaned: true,
      deleted: {
        orders: orderIds.length,
        entitlements: noteId ? "removed" : 0,
        webhook_events: eventIds.length,
        private_pdf: !!note.storage_path,
        marketplace_product: true,
        study_note: true,
        temporary_buyer: !!buyerMatch
      },
      note: "Razorpay Test Mode transaction history remains in the provider dashboard; no real money was involved."
    });
  } catch (error) {
    console.error("cleanup test fixture:", error.message);
    return json(res, 503, { error: error.message || "Temporary test fixture cleanup failed." });
  }
};
