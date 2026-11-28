# Razorpay integration setup (FreeCVResume)

This branch contains a **payment backend foundation**, not a live payment service yet. Live checkout remains disabled until the steps below are completed and tested.

## Vercel server environment variables
Add these in Vercel Project → Settings → Environment Variables (Preview first):
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY (server only; NEVER put this in index.html)
- RAZORPAY_KEY_ID
- RAZORPAY_KEY_SECRET (server only)
- RAZORPAY_WEBHOOK_SECRET (server only)

Use Razorpay Test Mode keys first. Never commit secrets to GitHub.

## Supabase
1. Review and run `supabase/migrations/202611270001_marketplace_payments.sql` in Supabase SQL Editor.
2. Populate `marketplace_products` only from an admin-controlled publishing workflow. `id` must match the note ID used by the site; amount is in paise (₹10 = 1000); creator_user_id must be a Supabase Auth UUID. Keep `active=false` and `delivery_ready=false` until the PDF is in private storage and an authenticated server-side delivery endpoint checks the buyer's entitlement. The create-order API refuses products unless both flags are true.
3. The current localStorage creator login is NOT accepted by these payment APIs. Buyers must sign in with Supabase Auth and send its access token as a Bearer token.
4. Do not activate product rows until secure PDF storage/entitlement checks prevent direct public-URL sharing.

## Razorpay Dashboard
1. Create the account and finish KYC / business verification.
2. Start in Test Mode; create a webhook pointing to `https://YOUR-DOMAIN/api/payments/webhook`.
3. Subscribe to `payment.captured` and relevant refund events when refund processing is implemented.
4. Copy the webhook secret into Vercel. Do not confuse it with the API key secret.
5. For multi-creator payouts, obtain Razorpay approval for Route/Linked Accounts and complete its onboarding. This foundation does not transfer creator money automatically.

## Private paid-PDF delivery
- Paid PDFs are stored only in the private `paid-notes-private` bucket (50 MiB maximum; PDF MIME type only).
- `POST /api/payments/create-private-upload` issues a short-lived upload token only to the authenticated owner of a paid note.
- `POST /api/payments/finish-private-upload` verifies the uploaded object and records its private storage path.
- `GET /api/payments/private-download?note_id=...` checks the buyer's entitlement server-side and returns a 120-second signed URL.
- Paid-note publishing requires an original PDF; the old public URL / database-chunk fallback is not used for paid PDFs.
- Keep `delivery_ready=false` until the private upload and entitlement download flow has passed end-to-end tests.

## API endpoints
- POST `/api/payments/create-order` with JSON `{"note_id":"..." }` and Supabase Auth Bearer token.
- POST `/api/payments/verify` with Razorpay Checkout response fields and same Bearer token.
- POST `/api/payments/publish-product` with `{ "note_id": "..." }` and an Admin Supabase Auth Bearer token, after the paid PDF has been uploaded privately.
- POST `/api/payments/webhook` (Razorpay server-to-server). Captured events grant entitlements; failed events mark still-created orders as failed.

The create-order endpoint reads price and creator from the server-controlled `marketplace_products` table. Browser-supplied prices are ignored. The PDF must remain locked unless the server verifies a captured payment and grants an entitlement.

## Important limitations before launch
- Frontend checkout now uses the real Supabase Auth access token, creates a server-priced Razorpay order, verifies the captured payment server-side, and checks the entitlement again before unlocking the reader. Paid PDF rendering is hidden unless the server confirms an entitlement.
- Existing creator accounts/notes still include localStorage-based flows; do not use those for paid access or creator payout.
- Private paid-PDF upload and authenticated download endpoints are implemented. Admins can publish an approved paid note through `POST /api/payments/publish-product`; the endpoint verifies the exact private PDF object before setting `active=true` and `delivery_ready=true`. Notes without a verified private PDF remain unavailable for checkout.
- Captured payments are recorded as pending ledger entries. Creator/platform shares remain zero and no payout amount is calculated until actual Razorpay settlement fees, taxes, refunds, chargebacks and the approved revenue-share policy are reconciled. Do not pay creators from gross captured amounts.
- Refund/chargeback reversal, admin product publishing, creator KYC, payout approval, secure PDF delivery, and end-to-end Test Mode verification remain required.
- Do not enable live sales or payouts until all controls and legal/provider approvals are complete.
