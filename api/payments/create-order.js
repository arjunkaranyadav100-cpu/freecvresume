const { json, env, getBearer, supabaseUser, supabaseAdmin } = require("../_lib/razorpay");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const token = getBearer(req);
    if (!token) return json(res, 401, { error: "Sign in is required before checkout." });
    const user = await supabaseUser(token);
    if (!user || !user.id) return json(res, 401, { error: "Your session is invalid or expired." });
    const noteId = String((req.body || {}).note_id || "").trim();
    if (!noteId) return json(res, 400, { error: "note_id is required." });

    // Only an admin-published catalog row is purchasable. Never accept price/creator from the browser.
    const products = await supabaseAdmin(
      "marketplace_products?select=id,title,amount_paise,currency,active,delivery_ready&id=eq." + encodeURIComponent(noteId) + "&active=eq.true&delivery_ready=eq.true&limit=1"
    );
    if (!Array.isArray(products) || !products.length) return json(res, 404, { error: "This note is not approved for secure PDF delivery and checkout yet." });
    const product = products[0];
    const amount = Number(product.amount_paise);
    if (!Number.isSafeInteger(amount) || amount < 100) return json(res, 400, { error: "Invalid product price configuration." });
    const currency = String(product.currency || "INR").toUpperCase();
    if (currency !== "INR") return json(res, 400, { error: "Only INR checkout is currently supported." });

    const receipt = "fcv_" + cryptoRandomId();
    const rpResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(env("RAZORPAY_KEY_ID") + ":" + env("RAZORPAY_KEY_SECRET")).toString("base64"),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ amount, currency, receipt, notes: { note_id: noteId, buyer_user_id: user.id } })
    });
    const rpOrder = await rpResponse.json();
    if (!rpResponse.ok || !rpOrder.id) return json(res, 502, { error: "Payment provider could not create the order." });

    await supabaseAdmin("rpc/create_marketplace_order", {
      method: "POST",
      body: JSON.stringify({
        p_razorpay_order_id: rpOrder.id,
        p_note_id: noteId,
        p_buyer_user_id: user.id,
        p_amount_paise: amount,
        p_currency: currency
      })
    });
    return json(res, 200, {
      order_id: rpOrder.id, amount: rpOrder.amount, currency: rpOrder.currency,
      key_id: env("RAZORPAY_KEY_ID"), product_title: product.title
    });
  } catch (error) {
    console.error("create-order:", error.message);
    return json(res, 503, { error: "Secure checkout is not configured yet. No payment was taken." });
  }
};

function cryptoRandomId() {
  return require("crypto").randomBytes(8).toString("hex");
}
