const crypto = require("crypto");
const { json, env, supabaseAdmin, safeEqual } = require("../_lib/razorpay");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const expected = crypto.createHmac("sha256", env("RAZORPAY_WEBHOOK_SECRET")).update(raw).digest("hex");
    const received = req.headers["x-razorpay-signature"] || "";
    if (!safeEqual(expected, received)) return json(res, 400, { error: "Invalid webhook signature." });

    const eventId = String(req.headers["x-razorpay-event-id"] || "");
    if (!eventId) return json(res, 400, { error: "Missing event ID." });
    const event = JSON.parse(raw.toString("utf8"));
    const payment = event.payload && event.payload.payment && event.payload.payment.entity;
    if (event.event === "payment.captured" && payment && payment.order_id) {
      await supabaseAdmin("rpc/complete_marketplace_payment_webhook", {
        method: "POST",
        body: JSON.stringify({
          p_event_id: eventId,
          p_razorpay_order_id: payment.order_id,
          p_razorpay_payment_id: payment.id,
          p_amount_paise: Number(payment.amount)
        })
      });
    } else {
      await supabaseAdmin("rpc/record_marketplace_webhook_event", {
        method: "POST",
        body: JSON.stringify({ p_event_id: eventId, p_event_type: event.event || "unknown", p_payload: event })
      });
    }
    return json(res, 200, { received: true });
  } catch (error) {
    console.error("razorpay webhook:", error.message);
    return json(res, 500, { error: "Webhook processing failed; provider may retry." });
  }
};
