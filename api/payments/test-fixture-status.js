const crypto = require("crypto");
const EventEmitter = require("events");
const {
  json, env, getBearer, supabaseUser, supabaseAdmin
} = require("../_lib/razorpay");
const webhookHandler = require("./webhook");

module.exports = async function handler(req, res) {
  if (process.env.VERCEL_ENV !== "preview") {
    return json(res, 404, { error: "Preview-only endpoint." });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const token = getBearer(req);
    if (!token) return json(res, 401, { error: "Admin sign-in is required." });
    const user = await supabaseUser(token);
    if (!user || !user.id) {
      return json(res, 401, { error: "Admin session is invalid or expired." });
    }
    const profiles = await supabaseAdmin(
      "profiles?select=id,role&id=eq." + encodeURIComponent(user.id) + "&limit=1"
    );
    if (!Array.isArray(profiles) || !profiles.length || profiles[0].role !== "admin") {
      return json(res, 403, { error: "Admin permission is required." });
    }

    if (req.method === "POST" && req.query.mode === "webhook-self-test") {
      let eventId = "";
      try {
        // Create a harmless synthetic event, signed with the actual Preview webhook secret.
        eventId = "diag_" + Date.now() + "_" + crypto.randomBytes(8).toString("hex");
        const event = {
          entity: "event",
          account_id: "diagnostic",
          event: "diagnostic.ping",
          contains: [],
          created_at: Math.floor(Date.now() / 1000),
          payload: {}
        };
        const raw = Buffer.from(JSON.stringify(event), "utf8");
        const signature = crypto.createHmac("sha256", env("RAZORPAY_WEBHOOK_SECRET"))
          .update(raw).digest("hex");

        // Exercise the same handler used by Razorpay without creating an order or charge.
        const mockReq = new EventEmitter();
        mockReq.method = "POST";
        mockReq.headers = {
          "x-razorpay-event-id": eventId,
          "x-razorpay-signature": signature
        };
        let responseStatus = 0;
        let responseBody = null;
        const mockRes = {
          status(code) { responseStatus = code; return this; },
          setHeader() { return this; },
          send(body) { responseBody = body; return this; }
        };

        const run = webhookHandler(mockReq, mockRes);
        mockReq.emit("data", raw);
        mockReq.emit("end");
        await run;

        if (responseStatus !== 200) {
          throw new Error(
            "Webhook handler returned HTTP " + responseStatus +
            (responseBody && responseBody.error ? ": " + responseBody.error : "")
          );
        }

        const rows = await supabaseAdmin(
          "marketplace_webhook_events?select=event_id,event_type&event_id=eq." +
          encodeURIComponent(eventId) + "&limit=1"
        );
        const recorded = Array.isArray(rows) && rows.some(
          row => row.event_id === eventId && row.event_type === "diagnostic.ping"
        );
        if (!recorded) throw new Error("Webhook RPC did not persist the diagnostic event.");

        await supabaseAdmin(
          "marketplace_webhook_events?event_id=eq." + encodeURIComponent(eventId),
          { method: "DELETE", headers: { Prefer: "return=minimal" } }
        );
        const remaining = await supabaseAdmin(
          "marketplace_webhook_events?select=event_id&event_id=eq." +
          encodeURIComponent(eventId) + "&limit=1"
        );
        const cleaned = Array.isArray(remaining) && remaining.length === 0;
        if (!cleaned) throw new Error("Diagnostic event cleanup could not be confirmed.");

        return json(res, 200, {
          ok: true,
          mode: "preview",
          signature_verification: "passed",
          webhook_handler: "passed",
          supabase_event_rpc: "passed",
          diagnostic_row_created: true,
          diagnostic_row_cleaned: true,
          razorpay_delivery_verified: false,
          note: "This validates the Preview app internally; it does not simulate delivery from Razorpay."
        });
      } catch (error) {
        if (eventId) {
          try {
            await supabaseAdmin(
              "marketplace_webhook_events?event_id=eq." + encodeURIComponent(eventId),
              { method: "DELETE", headers: { Prefer: "return=minimal" } }
            );
          } catch (_) {}
        }
        throw error;
      }
    }

    if (req.method !== "GET") return json(res, 400, { error: "Unsupported test-fixture operation." });
    const noteId = String(req.query.note_id || "");
    if (!/^custom-note-fcvtest-[a-f0-9]{14}$/.test(noteId)) {
      return json(res, 400, { error: "Invalid test fixture ID." });
    }
    const notes = await supabaseAdmin(
      "study_notes?select=id,title,storage_path,moderation_status&id=eq." +
      encodeURIComponent(noteId) + "&limit=1"
    );
    if (!Array.isArray(notes) || !notes.length) {
      return json(res, 404, { error: "Test fixture not found." });
    }
    const orders = await supabaseAdmin(
      "marketplace_orders?select=id,razorpay_order_id,status,amount_paise,paid_at&note_id=eq." +
      encodeURIComponent(noteId)
    );
    const entitlements = await supabaseAdmin(
      "marketplace_entitlements?select=id,note_id,order_id&note_id=eq." +
      encodeURIComponent(noteId)
    );
    const ledger = orders.length ? await supabaseAdmin(
      "creator_ledger?select=id,order_id,settlement_status&order_id=in.(" +
      orders.map(o => o.id).join(",") + ")"
    ) : [];
    const events = await supabaseAdmin(
      "marketplace_webhook_events?select=event_id,event_type,payload&limit=1000"
    );
    const orderMap = new Map(orders.map(o => [o.razorpay_order_id, o]));
    const matchedEvents = (events || []).filter(event => {
      const p = event.payload || {};
      const orderId = p.order_id ||
        (p.payload && p.payload.payment && p.payload.payment.entity && p.payload.payment.entity.order_id);
      return orderMap.has(orderId);
    }).map(event => {
      const p = event.payload || {};
      const orderId = p.order_id ||
        (p.payload && p.payload.payment && p.payload.payment.entity && p.payload.payment.entity.order_id);
      return {
        event_type: event.event_type,
        order_id: orderId,
        processed_at: event.processed_at || null
      };
    });
    return json(res, 200, {
      note: {
        id: notes[0].id,
        title: notes[0].title,
        private_pdf_present: !!notes[0].storage_path,
        moderation_status: notes[0].moderation_status
      },
      orders: orders.map(o => ({
        order_id: o.razorpay_order_id,
        status: o.status,
        amount_paise: o.amount_paise,
        paid_at: o.paid_at
      })),
      webhook_events: matchedEvents,
      entitlement_count: entitlements.length,
      ledger_entries: ledger.length
    });
  } catch (error) {
    console.error("test fixture status:", error.message);
    const isWebhookSelfTest = req.method === "POST" && req.query.mode === "webhook-self-test";
    const safeDetail = String(error && error.message || "Unknown error").slice(0, 240);
    return json(res, 503, {
      error: isWebhookSelfTest
        ? "Preview webhook self-test failed: " + safeDetail
        : "Could not read the test fixture status."
    });
  }
};
