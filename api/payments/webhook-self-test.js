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
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  let eventId = "";
  let recorded = false;
  let cleaned = false;

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

    // Use the real Preview webhook secret, but never reveal or log it.
    const secret = env("RAZORPAY_WEBHOOK_SECRET");
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
    const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");

    // Invoke the exact production webhook handler with an in-memory HTTP request.
    // No real payment, buyer, order, or customer data is used.
    const mockReq = new EventEmitter();
    mockReq.method = "POST";
    mockReq.headers = {
      "x-razorpay-event-id": eventId,
      "x-razorpay-signature": signature
    };

    let responseStatus = 0;
    let responseBody = null;
    const mockRes = {
      status(code) {
        responseStatus = code;
        return this;
      },
      setHeader() {
        return this;
      },
      send(body) {
        responseBody = body;
        return this;
      }
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
    recorded = Array.isArray(rows) && rows.some(
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
    cleaned = Array.isArray(remaining) && remaining.length === 0;

    return json(res, 200, {
      ok: true,
      mode: "preview",
      signature_verification: "passed",
      webhook_handler: "passed",
      supabase_event_rpc: "passed",
      diagnostic_row_created: recorded,
      diagnostic_row_cleaned: cleaned,
      razorpay_delivery_verified: false,
      note: "This self-test validates the Preview app's handler and secret internally. It does not simulate delivery from Razorpay."
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
    console.error("[razorpay-webhook-self-test] failed", error.message);
    return json(res, 503, {
      ok: false,
      error: "Preview webhook self-test failed.",
      detail: error.message
    });
  }
};
