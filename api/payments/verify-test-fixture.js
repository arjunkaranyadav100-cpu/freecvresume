const { json, env, getBearer, supabaseUser, supabaseAdmin, razorpaySignature, safeEqual } = require("../_lib/razorpay");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const token = getBearer(req);
    if (!token) return json(res, 401, { error: "Admin sign-in is required." });
    const user = await supabaseUser(token);
    if (!user || !user.id) return json(res, 401, { error: "Admin session is invalid or expired." });
    const profiles = await supabaseAdmin("profiles?select=id,role&id=eq." + encodeURIComponent(user.id) + "&limit=1");
    if (!Array.isArray(profiles) || !profiles.length || profiles[0].role !== "admin") return json(res, 403, { error: "Admin permission is required." });
    if (!env("RAZORPAY_KEY_ID").startsWith("rzp_test_")) return json(res, 409, { error: "Test-only verification is disabled outside Razorpay Test Mode." });

    const body = req.body || {};
    const noteId = String(body.note_id || "");
    const orderId = String(body.razorpay_order_id || "");
    const paymentId = String(body.razorpay_payment_id || "");
    const signature = String(body.razorpay_signature || "");
    if (!/^custom-note-fcvtest-[a-f0-9]{14}$/.test(noteId) || !orderId || !paymentId || !signature) {
      return json(res, 400, { error: "Test fixture or payment verification fields are invalid." });
    }
    const orders = await supabaseAdmin(
      "marketplace_orders?select=id,razorpay_order_id,note_id,buyer_user_id,amount_paise,currency,status&razorpay_order_id=eq." +
      encodeURIComponent(orderId) + "&note_id=eq." + encodeURIComponent(noteId) + "&limit=1"
    );
    if (!Array.isArray(orders) || !orders.length) return json(res, 404, { error: "Temporary test order was not found." });
    const order = orders[0];
    if (!safeEqual(razorpaySignature(orderId, paymentId), signature)) return json(res, 400, { error: "Payment signature is invalid." });

    const auth = "Basic " + Buffer.from(env("RAZORPAY_KEY_ID") + ":" + env("RAZORPAY_KEY_SECRET")).toString("base64");
    let paymentResponse = await fetch("https://api.razorpay.com/v1/payments/" + encodeURIComponent(paymentId), { headers: { Authorization: auth } });
    let payment = await paymentResponse.json();
    if (!paymentResponse.ok || payment.order_id !== orderId || payment.amount !== 100 || payment.currency !== "INR") {
      return json(res, 409, { error: "Razorpay payment does not match this ₹1 test order." });
    }
    if (payment.status === "authorized") {
      paymentResponse = await fetch("https://api.razorpay.com/v1/payments/" + encodeURIComponent(paymentId) + "/capture", {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 100, currency: "INR" })
      });
      payment = await paymentResponse.json();
    }
    if (!paymentResponse.ok || payment.status !== "captured") {
      return json(res, 409, { error: "Razorpay has not confirmed a captured test payment; entitlement remains locked." });
    }

    const result = await supabaseAdmin("rpc/complete_marketplace_payment", {
      method: "POST",
      body: JSON.stringify({
        p_razorpay_order_id: orderId,
        p_razorpay_payment_id: paymentId,
        p_buyer_user_id: order.buyer_user_id,
        p_amount_paise: 100
      })
    });
    return json(res, 200, { verified: true, captured: true, result });
  } catch (error) {
    console.error("verify test payment:", error.message);
    return json(res, 503, { error: "Temporary test payment could not be verified securely." });
  }
};
