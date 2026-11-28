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
    if (!env("RAZORPAY_KEY_ID").startsWith("rzp_test_")) return json(res, 409, { error: "Cleanup is disabled outside Razorpay Test Mode." });

    const notes = await supabaseAdmin(
      "study_notes?select=id,title,creator_id,storage_path,moderation_note,category&id=like.custom-note-fcvtest-*&limit=100"
    );
    const fixtures = (Array.isArray(notes) ? notes : []).filter(n =>
      String(n.title || "").startsWith("[TEST ONLY]") && n.category === "_chunk" &&
      /^custom-note-fcvtest-[a-f0-9]{14}$/.test(String(n.id || ""))
    );
    if (!fixtures.length) return json(res, 200, { cleaned: true, fixtures: 0, deleted: { notes: 0, products: 0, orders: 0, entitlements: 0, ledger: 0, private_pdfs: 0, buyers: 0, webhook_events: 0 } });

    let counts = { notes: 0, products: 0, orders: 0, entitlements: 0, ledger: 0, private_pdfs: 0, buyers: 0, webhook_events: 0 };
    const allOrderRows = [];
    const allRazorpayOrderIds = [];
    const buyerIds = [];
    const fixtureIds = fixtures.map(n => n.id);

    for (const note of fixtures) {
      const orders = await supabaseAdmin("marketplace_orders?select=id,razorpay_order_id&note_id=eq." + encodeURIComponent(note.id));
      for (const order of (Array.isArray(orders) ? orders : [])) {
        allOrderRows.push(order);
        allRazorpayOrderIds.push(order.razorpay_order_id);
      }
      const match = String(note.moderation_note || "").match(/^fcv_test_fixture_buyer:([0-9a-f-]{36})$/i);
      if (match) buyerIds.push(match[1]);
    }

    if (allRazorpayOrderIds.length) {
      const events = await supabaseAdmin("marketplace_webhook_events?select=event_id,payload&limit=1000");
      for (const event of (Array.isArray(events) ? events : [])) {
        const p = event.payload || {};
        const orderId = p.order_id || (p.payload && p.payload.payment && p.payload.payment.entity && p.payload.payment.entity.order_id);
        if (allRazorpayOrderIds.includes(orderId)) {
          await supabaseAdmin("marketplace_webhook_events?event_id=eq." + encodeURIComponent(event.event_id), { method: "DELETE" });
          counts.webhook_events++;
        }
      }
    }
    for (const order of allOrderRows) {
      await supabaseAdmin("creator_ledger?order_id=eq." + encodeURIComponent(order.id), { method: "DELETE" });
      counts.ledger++;
    }
    for (const note of fixtures) {
      await supabaseAdmin("marketplace_entitlements?note_id=eq." + encodeURIComponent(note.id), { method: "DELETE" });
      counts.entitlements++;
      await supabaseAdmin("marketplace_orders?note_id=eq." + encodeURIComponent(note.id), { method: "DELETE" });
      counts.orders++;
      await supabaseAdmin("marketplace_products?id=eq." + encodeURIComponent(note.id), { method: "DELETE" });
      counts.products++;
      if (note.storage_path) {
        const remove = await fetch(env("SUPABASE_URL") + "/storage/v1/object/paid-notes-private/" + note.storage_path.split("/").map(encodeURIComponent).join("/"), {
          method: "DELETE",
          headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY") }
        });
        if (!remove.ok && remove.status !== 404) throw new Error("Private test PDF cleanup failed.");
        counts.private_pdfs++;
      }
      await supabaseAdmin("study_notes?id=eq." + encodeURIComponent(note.id), { method: "DELETE" });
      counts.notes++;
    }
    for (const buyerId of [...new Set(buyerIds)]) {
      const removeBuyer = await fetch(env("SUPABASE_URL") + "/auth/v1/admin/users/" + encodeURIComponent(buyerId), {
        method: "DELETE",
        headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY") }
      });
      if (!removeBuyer.ok && removeBuyer.status !== 404) throw new Error("Temporary buyer cleanup failed.");
      counts.buyers++;
    }
    return json(res, 200, {
      cleaned: true,
      fixtures: fixtures.length,
      deleted: counts,
      note: "Razorpay Test Mode orders remain visible in the provider's test transaction history; no real funds were moved."
    });
  } catch (error) {
    console.error("cleanup all test fixtures:", error.message);
    return json(res, 503, { error: error.message || "Temporary test fixture cleanup failed." });
  }
};
