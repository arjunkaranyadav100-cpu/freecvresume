const { json, env, getBearer, supabaseUser, supabaseAdmin, razorpaySignature, safeEqual } = require("../_lib/razorpay");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const token = getBearer(req);
    if (!token) return json(res, 401, { error: "Sign in is required." });
    const user = await supabaseUser(token);
    if (!user || !user.id) return json(res, 401, { error: "Your session is invalid or expired." });
    const body = req.body || {};
    const orderId = String(body.razorpay_order_id || "");
    const paymentId = String(body.razorpay_payment_id || "");
    const signature = String(body.razorpay_signature || "");
    if (!orderId || !paymentId || !signature) return json(res, 400, { error: "Payment verification fields are incomplete." });
    if (!safeEqual(razorpaySignature(orderId, paymentId), signature)) return json(res, 400, { error: "Payment signature is invalid." });

    const paymentResponse = await fetch("https://api.razorpay.com/v1/payments/" + encodeURIComponent(paymentId), {
      headers: { Authorization: "Basic " + Buffer.from(env("RAZORPAY_KEY_ID") + ":" + env("RAZORPAY_KEY_SECRET")).toString("base64") }
    });
    const payment = await paymentResponse.json();
    if (!paymentResponse.ok || payment.order_id !== orderId || payment.status !== "captured") {
      return json(res, 409, { error: "Payment is not captured. The PDF remains locked." });
    }
    if (String(payment.amount) === "" || !Number.isSafeInteger(Number(payment.amount))) return json(res, 400, { error: "Invalid captured amount." });

    const result = await supabaseAdmin("rpc/complete_marketplace_payment", {
      method: "POST",
      body: JSON.stringify({
        p_razorpay_order_id: orderId,
        p_razorpay_payment_id: paymentId,
        p_buyer_user_id: user.id,
        p_amount_paise: Number(payment.amount)
      })
    });
    return json(res, 200, { verified: true, result });
  } catch (error) {
    console.error("payment verify:", error.message);
    return json(res, 503, { error: "We could not verify this payment. The PDF will remain locked until verification succeeds." });
  }
};
