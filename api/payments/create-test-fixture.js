const crypto = require("crypto");
const { json, env, getBearer, supabaseUser, supabaseAdmin } = require("../_lib/razorpay");

const TEST_PDF_BASE64 = "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiAvRjIgNSAwIFIgPj4gPj4gL0NvbnRlbnRzIDYgMCBSID4+CmVuZG9iago0IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EtQm9sZCA+PgplbmRvYmoKNiAwIG9iago8PCAvTGVuZ3RoIDcwNSA+PgpzdHJlYW0KQlQKL0YyIDIwIFRmCjYwIDc2MCBUZAooRnJlZUNWUmVzdW1lIFRlc3QgTm90ZSkgVGoKMCAtMzYgVGQKL0YyIDE0IFRmCihSYXpvcnBheSBUZXN0IE1vZGUgLSBJTlIgMS4wMCkgVGoKMCAtMzYgVGQKL0YxIDExIFRmCihUaGlzIGlzIGEgdGVtcG9yYXJ5LCBub24tY29tbWVyY2lhbCB0ZXN0IGRvY3VtZW50LikgVGoKMCAtMjAgVGQKKEl0IHZlcmlmaWVzIHByaXZhdGUgUERGIGRlbGl2ZXJ5IG9uIHRoZSBQcmV2aWV3IGRlcGxveW1lbnQgb25seS4pIFRqCjAgLTIwIFRkCihObyBzdHVkeSBtYXRlcmlhbCBvciBjb3B5cmlnaHRlZCBjb250ZW50IGlzIGluY2x1ZGVkLikgVGoKMCAtMzYgVGQKL0YyIDEyIFRmCihUZXN0IGNoZWNrczopIFRqCjAgLTI0IFRkCi9GMSAxMSBUZgooMS4gVGVzdCBNb2RlIG9yZGVyIGNyZWF0aW9uIGFuZCBjYXB0dXJlIHZlcmlmaWNhdGlvbi4pIFRqCjAgLTIwIFRkCigyLiBwYXltZW50LmNhcHR1cmVkIHdlYmhvb2sgYW5kIGVudGl0bGVtZW50IGdyYW50LikgVGoKMCAtMjAgVGQKKDMuIHBheW1lbnQuZmFpbGVkIHdlYmhvb2sgYW5kIGZhaWxlZCBvcmRlciBoYW5kbGluZy4pIFRqCjAgLTMyIFRkCihUaGlzIG5vdGUgbXVzdCBuZXZlciBiZSBwdWJsaXNoZWQgdG8gUHJvZHVjdGlvbi4pIFRqCjAgLTIwIFRkCihSZW1vdmUgdGhpcyBmaXh0dXJlIGFuZCBpdHMgcmVjb3JkcyBhZnRlciB0ZXN0aW5nLikgVGoKRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA2NCAwMDAwMCBuIAowMDAwMDAwMTIxIDAwMDAwIG4gCjAwMDAwMDAyNTcgMDAwMDAgbiAKMDAwMDAwMDMyNyAwMDAwMCBuIAowMDAwMDAwNDAyIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNyAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMTE1NwolJUVPRgo=";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  let noteId = "";
  let buyerId = "";
  let storagePath = "";
  let productCreated = false;
  const orderIds = [];
  try {
    const token = getBearer(req);
    if (!token) return json(res, 401, { error: "Admin sign-in is required." });
    const user = await supabaseUser(token);
    if (!user || !user.id) return json(res, 401, { error: "Admin session is invalid or expired." });
    const profiles = await supabaseAdmin("profiles?select=id,role,display_name&id=eq." + encodeURIComponent(user.id) + "&limit=1");
    if (!Array.isArray(profiles) || !profiles.length || profiles[0].role !== "admin") {
      return json(res, 403, { error: "Only the Supabase admin can create a temporary test fixture." });
    }
    const keyId = env("RAZORPAY_KEY_ID");
    if (!keyId.startsWith("rzp_test_")) return json(res, 409, { error: "Preview is not using a Razorpay Test Mode key. No fixture was created." });
    env("RAZORPAY_KEY_SECRET");
    env("RAZORPAY_WEBHOOK_SECRET");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = env("SUPABASE_URL");
    const tag = crypto.randomBytes(7).toString("hex");
    noteId = "custom-note-fcvtest-" + tag;
    const title = "[TEST ONLY] FreeCVResume ₹1 Preview Checkout";
    const buyerEmail = "fcv-test-buyer-" + tag + "@example.com";
    const buyerPassword = crypto.randomBytes(28).toString("base64url");

    const buyerResponse = await fetch(supabaseUrl + "/auth/v1/admin/users", {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: buyerEmail,
        password: buyerPassword,
        email_confirm: true,
        user_metadata: { full_name: "FreeCV Temporary Test Buyer" },
        app_metadata: { fcv_test_fixture_id: noteId }
      })
    });
    const buyerData = await buyerResponse.json();
    if (!buyerResponse.ok || !buyerData.id) throw new Error("Temporary test buyer could not be created.");
    buyerId = buyerData.id;

    storagePath = user.id + "/" + noteId + ".pdf";
    const pdfBytes = Buffer.from(TEST_PDF_BASE64, "base64");
    const uploadResponse = await fetch(
      supabaseUrl + "/storage/v1/object/paid-notes-private/" + storagePath.split("/").map(encodeURIComponent).join("/"),
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: "Bearer " + serviceKey,
          "Content-Type": "application/pdf",
          "x-upsert": "true"
        },
        body: pdfBytes
      }
    );
    if (!uploadResponse.ok) throw new Error("Temporary PDF could not be stored in the private bucket.");

    await supabaseAdmin("study_notes", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        id: noteId,
        title,
        category: "_chunk",
        subject: "gk-gs",
        language: "english",
        badge: "INTERNAL TEST",
        price: 1,
        creator: profiles[0].display_name || "FreeCV Admin",
        upi: "test@razorpay",
        content: "Temporary non-commercial test fixture. Hidden from public notes; used only to test Razorpay Test Mode and private PDF entitlement delivery.",
        url: "",
        views: 0,
        sales: 0,
        rating: 5,
        creator_id: user.id,
        moderation_status: "approved",
        moderation_note: "fcv_test_fixture_buyer:" + buyerId,
        moderated_at: new Date().toISOString(),
        moderated_by: user.id,
        storage_path: storagePath
      }])
    });

    const productRows = await supabaseAdmin("marketplace_products?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify([{
        id: noteId,
        title,
        amount_paise: 100,
        currency: "INR",
        creator_user_id: user.id,
        active: true,
        delivery_ready: true,
        updated_at: new Date().toISOString()
      }])
    });
    if (!Array.isArray(productRows) || !productRows.length) throw new Error("Temporary checkout product could not be prepared.");
    productCreated = true;

    const buyerLoginResponse = await fetch(supabaseUrl + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: env("SUPABASE_ANON_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ email: buyerEmail, password: buyerPassword })
    });
    const buyerSession = await buyerLoginResponse.json();
    if (!buyerLoginResponse.ok || !buyerSession.access_token || !buyerSession.user || buyerSession.user.id !== buyerId) {
      throw new Error("Temporary buyer session could not be established.");
    }

    return json(res, 200, {
      created: true,
      test_mode: true,
      note_id: noteId,
      title,
      amount_rupees: 1,
      private_pdf_verified: true,
      buyer_access_token: buyerSession.access_token
    });
  } catch (error) {
    try {
      for (const orderId of orderIds) {
        await supabaseAdmin("marketplace_orders?razorpay_order_id=eq." + encodeURIComponent(orderId), { method: "DELETE" });
      }
      if (productCreated && noteId) await supabaseAdmin("marketplace_products?id=eq." + encodeURIComponent(noteId), { method: "DELETE" });
      if (noteId) await supabaseAdmin("study_notes?id=eq." + encodeURIComponent(noteId), { method: "DELETE" });
      if (storagePath) {
        await fetch(env("SUPABASE_URL") + "/storage/v1/object/paid-notes-private/" + storagePath.split("/").map(encodeURIComponent).join("/"), {
          method: "DELETE",
          headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY") }
        });
      }
      if (buyerId) {
        await fetch(env("SUPABASE_URL") + "/auth/v1/admin/users/" + encodeURIComponent(buyerId), {
          method: "DELETE",
          headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY") }
        });
      }
    } catch (cleanupError) {
      console.error("test fixture rollback:", cleanupError.message);
    }
    console.error("create test fixture:", error.message);
    return json(res, 503, { error: error.message || "Could not create the temporary test fixture." });
  }
};
