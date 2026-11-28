const { json, getBearer, supabaseUser, supabaseAdmin } = require("../_lib/razorpay");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  try {
    const token = getBearer(req);
    if (!token) return json(res, 401, { error: "Admin sign-in is required." });
    const user = await supabaseUser(token);
    if (!user || !user.id) return json(res, 401, { error: "Admin session is invalid or expired." });
    const profiles = await supabaseAdmin("profiles?select=id,role&id=eq." + encodeURIComponent(user.id) + "&limit=1");
    if (!Array.isArray(profiles) || !profiles.length || profiles[0].role !== "admin") return json(res, 403, { error: "Admin permission is required." });
    const noteId = String(req.query.note_id || "");
    if (!/^custom-note-fcvtest-[a-f0-9]{14}$/.test(noteId)) return json(res, 400, { error: "Invalid test fixture ID." });
    const notes = await supabaseAdmin("study_notes?select=id,title,storage_path,moderation_status&id=eq." + encodeURIComponent(noteId) + "&limit=1");
    if (!Array.isArray(notes) || !notes.length) return json(res, 404, { error: "Test fixture not found." });
    const orders = await supabaseAdmin("marketplace_orders?select=id,razorpay_order_id,status,amount_paise,paid_at&note_id=eq." + encodeURIComponent(noteId));
    const entitlements = await supabaseAdmin("marketplace_entitlements?select=id,note_id,order_id&note_id=eq." + encodeURIComponent(noteId));
    const ledger = orders.length ? await supabaseAdmin("creator_ledger?select=id,order_id,settlement_status&order_id=in.(" + orders.map(o => o.id).join(",") + ")") : [];
    const events = await supabaseAdmin("marketplace_webhook_events?select=event_id,event_type,payload&limit=1000");
    const orderMap = new Map(orders.map(o => [o.razorpay_order_id, o]));
    const matchedEvents = (events || []).filter(event => {
      const p = event.payload || {};
      const orderId = p.order_id || (p.payload && p.payload.payment && p.payload.payment.entity && p.payload.payment.entity.order_id);
      return orderMap.has(orderId);
    }).map(event => {
      const p = event.payload || {};
      const orderId = p.order_id || (p.payload && p.payload.payment && p.payload.payment.entity && p.payload.payment.entity.order_id);
      return { event_type: event.event_type, order_id: orderId, processed_at: event.processed_at || null };
    });
    return json(res, 200, {
      note: { id: notes[0].id, title: notes[0].title, private_pdf_present: !!notes[0].storage_path, moderation_status: notes[0].moderation_status },
      orders: orders.map(o => ({ order_id: o.razorpay_order_id, status: o.status, amount_paise: o.amount_paise, paid_at: o.paid_at })),
      webhook_events: matchedEvents,
      entitlement_count: entitlements.length,
      ledger_entries: ledger.length
    });
  } catch (error) {
    console.error("test fixture status:", error.message);
    return json(res, 503, { error: "Could not read the test fixture status." });
  }
};
