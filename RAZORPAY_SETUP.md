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
2. Populate `marketplace_products` only from an admin-controlled publishing workflow. `id` must match the note ID used by the site; amount is in paise (₹10 = 1000); creator_user_id must be a Supabase Auth UUID.
3. The current localStorage creator login is NOT accepted by these payment APIs. Buyers must sign in with Supabase Auth and send its access token as a Bearer token.
4. Do not activate product rows until secure PDF storage/entitlement checks prevent direct public-URL sharing.

## Razorpay Dashboard
1. Create the account and finish KYC / business verification.
2. Start in Test Mode; create a webhook pointing to `https://YOUR-DOMAIN/api/payments/webhook`.
3. Subscribe to `payment.captured` and relevant refund events when refund processing is implemented.
4. Copy the webhook secret into Vercel. Do not confuse it with the API key secret.
5. For multi-creator payouts, obtain Razorpay approval for Route/Linked Accounts and complete its onboarding. This foundation does not transfer creator money automatically.

## API endpoints
- POST `/api/payments/create-order` with JSON `{"note_id":"..." }` and Supabase Auth Bearer token.
- POST `/api/payments/verify` with Razorpay Checkout response fields and same Bearer token.
- POST `/api/payments/webhook` (Razorpay server-to-server).

The create-order endpoint reads price and creator from the server-controlled `marketplace_products` table. Browser-supplied prices are ignored. The PDF must remain locked unless the server verifies a captured payment and grants an entitlement.

## Important limitations before launch
- Frontend Supabase Auth integration and checkout UI are not yet wired.
- Existing creator accounts/notes still include localStorage-based flows; do not use those for paid access or creator payout.
- The ledger currently records a provisional 50/50 split on gross captured amount with gateway fee set to zero. Before payouts, reconcile actual Razorpay fees, taxes, refunds, chargebacks and Route settlement data; only then calculate distributable net revenue.
- Refund/chargeback reversal, admin product publishing, creator KYC, payout approval, secure PDF delivery, and end-to-end Test Mode verification remain required.
- Do not enable live sales or payouts until all controls and legal/provider approvals are complete.
