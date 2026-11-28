const crypto = require("crypto");
const { json, env, supabaseAdmin, safeEqual } = require("../_lib/razorpay");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    console.warn("[razorpay-webhook] rejected_method", { method: req.method || "unknown" });
    return json(res, 405, { error: "Method not allowed" });
  }
  try {
    const raw = await readRawBody(req);
    const eventId = String(req.headers["x-razorpay-event-id"] || "");
    const received = req.headers["x-razorpay-signature"] || "";
    console.info("[razorpay-webhook] received", {
      environment: process.env.VERCEL_ENV || "unknown",
      bytes: raw.length,
      signaturePresent: Boolean(received),
      eventIdPresent: Boolean(eventId)
    });

    const expected = crypto.createHmac("sha256", env("RAZORPAY_WEBHOOK_SECRET")).update(raw).digest("hex");
    if (!safeEqual(expected, received)) {
      console.warn("[razorpay-webhook] signature_rejected", {
        eventIdPresent: Boolean(eventId),
        bytes: raw.length
      });
      return json(res, 400, { error: "Invalid webhook signature." });
    }

    if (!eventId) {
      console.warn("[razorpay-webhook] missing_event_id", { bytes: raw.length });
      return json(res, 400, { error: "Missing event ID." });
    }
    const event = JSON.parse(raw.toString("utf8"));
    const payment = event.payload && event.payload.payment && event.payload.payment.entity;

    if (event.event === "payment.captured" && payment && payment.order_id && payment.currency === "INR" && Number.isSafeInteger(Number(payment.amount))) {
      await supabaseAdmin("rpc/complete_marketplace_payment_webhook", {
        method: "POST",
        body: JSON.stringify({
          p_event_id: eventId,
          p_razorpay_order_id: payment.order_id,
          p_razorpay_payment_id: payment.id,
          p_amount_paise: Number(payment.amount)
        })
      });
      console.info("[razorpay-webhook] processed", { eventId, eventType: "payment.captured" });
    } else if (event.event === "payment.failed" && payment && payment.order_id) {
      // Record every failure event, but never downgrade an order already marked paid.
      await supabaseAdmin("rpc/record_marketplace_webhook_event", {
        method: "POST",
        body: JSON.stringify({ p_event_id: eventId, p_event_type: event.event, p_payload: event })
      });
      await supabaseAdmin(
        "marketplace_orders?razorpay_order_id=eq." + encodeURIComponent(payment.order_id) + "&status=eq.created",
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ status: "failed", updated_at: new Date().toISOString() })
        }
      );
      console.info("[razorpay-webhook] processed", { eventId, eventType: "payment.failed" });
    } else {
      await supabaseAdmin("rpc/record_marketplace_webhook_event", {
        method: "POST",
        body: JSON.stringify({ p_event_id: eventId, p_event_type: event.event || "unknown", p_payload: event })
      });
      console.info("[razorpay-webhook] processed", {
        eventId,
        eventType: String(event.event || "unknown")
      });
    }
    return json(res, 200, { received: true });
  } catch (error) {
    console.error("[razorpay-webhook] processing_error", error.message);
    return json(res, 500, { error: "Webhook processing failed; provider may retry." });
  }
};


module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
