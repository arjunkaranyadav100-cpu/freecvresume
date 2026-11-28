const { json, env, getBearer, supabaseUser, supabaseAdmin } = require("../_lib/razorpay");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const token = getBearer(req);
    if (!token) return json(res, 401, { error: "Admin sign-in is required." });
    const user = await supabaseUser(token);
    if (!user || !user.id) return json(res, 401, { error: "Your session is invalid or expired." });

    // The admin role is read from the protected server-side profile row, never from browser data.
    const profiles = await supabaseAdmin(
      "profiles?select=id,role&id=eq." + encodeURIComponent(user.id) + "&limit=1"
    );
    if (!Array.isArray(profiles) || !profiles.length || profiles[0].role !== "admin") {
      return json(res, 403, { error: "Admin permission is required to publish paid notes." });
    }

    const noteId = String((req.body || {}).note_id || "").trim();
    if (!noteId || noteId.length > 180) return json(res, 400, { error: "A valid note_id is required." });

    const notes = await supabaseAdmin(
      "study_notes?select=id,title,price,creator_id,moderation_status,storage_path,url&id=eq." +
      encodeURIComponent(noteId) + "&limit=1"
    );
    if (!Array.isArray(notes) || !notes.length) return json(res, 404, { error: "Study note not found." });
    const note = notes[0];

    if (note.moderation_status !== "approved") {
      return json(res, 409, { error: "Approve the note before publishing it for paid checkout." });
    }
    const amountPaise = Number(note.price) * 100;
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 100) {
      return json(res, 400, { error: "The note must have a valid paid price of at least ₹1." });
    }
    if (!note.creator_id || !note.title) {
      return json(res, 409, { error: "The note is missing its creator or title." });
    }

    const expectedPath = String(note.creator_id) + "/" + noteId + ".pdf";
    if (note.storage_path !== expectedPath || String(note.url || "") !== "") {
      return json(res, 409, { error: "The original PDF must be uploaded to private paid-note storage before publishing." });
    }

    // Confirm that the exact private object still exists before marking delivery_ready=true.
    const storageResponse = await fetch(
      env("SUPABASE_URL") + "/storage/v1/object/info/paid-notes-private/" +
      expectedPath.split("/").map(encodeURIComponent).join("/"),
      {
        headers: {
          apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
          Authorization: "Bearer " + env("SUPABASE_SERVICE_ROLE_KEY")
        }
      }
    );
    if (!storageResponse.ok) {
      return json(res, 409, { error: "The private PDF could not be verified. Upload it again before publishing." });
    }
    const storageInfo = await storageResponse.json();
    if (storageInfo.contentType && storageInfo.contentType !== "application/pdf") {
      return json(res, 415, { error: "Only a verified application/pdf file can be published." });
    }

    const products = await supabaseAdmin("marketplace_products?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        id: note.id,
        title: note.title,
        amount_paise: amountPaise,
        currency: "INR",
        creator_user_id: note.creator_id,
        active: true,
        delivery_ready: true,
        updated_at: new Date().toISOString()
      })
    });
    return json(res, 200, {
      published: true,
      product: Array.isArray(products) ? products[0] || null : products
    });
  } catch (error) {
    console.error("publish paid product:", error.message);
    return json(res, 503, { error: "Could not securely publish this paid note." });
  }
};
