const crypto = require("crypto");

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").send(body);
}
function env(name) {
  const value = process.env[name];
  if (!value) throw new Error("Missing server environment variable: " + name);
  return value;
}
function getBearer(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}
async function supabaseUser(token) {
  const response = await fetch(env("SUPABASE_URL") + "/auth/v1/user", {
    headers: { apikey: env("SUPABASE_ANON_KEY"), Authorization: "Bearer " + token }
  });
  if (!response.ok) return null;
  return response.json();
}
async function supabaseAdmin(path, options = {}) {
  const response = await fetch(env("SUPABASE_URL") + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY"),
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  let data = null;
  try { data = body ? JSON.parse(body) : null; } catch (_) { data = body; }
  if (!response.ok) throw new Error("Supabase request failed (" + response.status + "): " + JSON.stringify(data));
  return data;
}
function razorpaySignature(orderId, paymentId) {
  return crypto.createHmac("sha256", env("RAZORPAY_KEY_SECRET"))
    .update(orderId + "|" + paymentId).digest("hex");
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
module.exports = { json, env, getBearer, supabaseUser, supabaseAdmin, razorpaySignature, safeEqual };
