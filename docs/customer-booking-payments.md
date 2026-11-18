# Customer booking calendar and payments

## Customer flow

1. Open `/book` to view the public Full Turf calendar. Register or sign in when reserving an available session or opening My bookings.
2. Use the Day or Week calendar. Times use the branch’s time zone. Fully paid sessions show **Already booked** and cannot be selected. Held or deposit-paid sessions show **Available · Call club** and open a phone inquiry; they remain unavailable for a second online reservation. Maintenance and unpriced sessions cannot be reserved online.
3. Enter the player count and reserve the session. The backend checks availability under a lane lock and creates the same booking visible in the staff calendar and All bookings.
4. Open **Pay booking** from the booking dialog. The balance is read from the backend.
5. Choose PayHere sandbox or bank transfer. Wallet payment remains available in the booking dialog when funded.

Unpaid reservations have an expiry. Uploading a slip does not confirm payment or extend the hold. Payment must be verified while the booking is active and the slot remains available. Contact the club to reconcile a transfer if the hold expires first.

## Bank account configuration

An administrator with `MANAGE_TENANT` opens **Dashboard → Payment settings** (`/dashboard/payments`). Enter bank name, account holder, account number, optional branch, and instructions. Enable bank transfers and save. These values are stored per tenant in PostgreSQL and appear at customer checkout. Disabled bank details are not exposed in customer payment options.

Players upload one JPG, PNG, or PDF slip up to 5 MB, enter the amount transferred, and optionally include the bank reference. The amount must satisfy the booking’s configured deposit or full balance. Only one slip may await review for a booking. New files are written atomically under `ATTACHMENTS_DIR/bookings/<bookingId>/<slipId>.<ext>`. Authenticated downloads check ownership or staff permissions and prevent path traversal. Legacy PostgreSQL byte records remain readable. List responses contain metadata, never file bytes or storage paths.

Staff with `RECORD_PAYMENT` open **All bookings → Bank transfer reviews**. View the attachment, verify funds against the bank statement, and approve or reject with an optional note. Approval writes one BANK_TRANSFER collection, updates the booking and its invoice balance, and confirms an eligible hold. Duplicate approvals cannot apply the same money twice. Rejection leaves the balance unchanged and allows a new slip. Staff can filter pending, approved, or rejected records and open the linked booking.

Staff can also attach a slip in Quick booking or Record payment. Choose **Funds received — record payment** for an atomic file/slip/collection operation, or **Save slip — awaiting review**. A failed upload keeps the same newly created hold and provides a retry instead of creating another booking. Staff without payment permission can submit a pending slip, but cannot mark it approved. Staff bookings default to `WALK_IN` and the signed-in staff member as lead owner; administrators can reassign the owner. Direct player bookings use `WEB`.

## PayHere sandbox configuration

The backend supports only `https://sandbox.payhere.lk/pay/checkout`. Live payments remain unavailable in this release. Set `PAYMENT_SETTINGS_ENCRYPTION_KEY` to a stable base64-encoded random 32-byte key on the backend, then open **Dashboard → Payment settings** to enter Merchant ID, Merchant Secret, notification URL, return origin, and club contact phone. Enable PayHere and save. Leaving the secret empty preserves it; the clear-secret action disables checkout. Responses contain only a configured flag, never plaintext or encrypted secrets.

Generate a key, for example, with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`, then store it privately in the backend environment. Keep and back up this key separately from the database. Per-tenant secrets and per-checkout credential snapshots use AES-256-GCM with tenant-bound authentication. Rotating or disabling merchant credentials does not invalidate notifications for existing checkout snapshots.

These legacy environment values remain a fallback until gateway settings are saved through the admin UI:

| Variable | Value |
| --- | --- |
| `PAYHERE_SANDBOX_ENABLED` | `1` to enable sandbox |
| `PAYHERE_TENANT_SLUG` | The arena tenant slug using this merchant account |
| `PAYHERE_MERCHANT_ID` | Sandbox merchant ID |
| `PAYHERE_MERCHANT_SECRET` | Sandbox merchant secret; backend only |
| `PAYHERE_NOTIFY_URL` | Public HTTPS URL ending `/api/payments/payhere/notify` |
| `PAYMENT_RETURN_ORIGIN` | Public frontend origin, without a path |

Register the site domain in the PayHere sandbox merchant account. PayHere cannot deliver notifications to localhost; use a reachable test deployment or HTTPS development tunnel. Docker Compose accepts the encryption key and legacy values from `.env`. Merchant credentials are not included in this repository, so sandbox checkout is initially unavailable.

Checkout collects billing address, city, and phone. The backend generates an order and checkout hash using the booking’s outstanding balance. Only a correctly signed notification with matching merchant, order, amount, and currency can apply payment. Browser return and cancel URLs refresh the booking and show its actual status; they do not prove payment. Repeated notifications cannot create duplicate collections.

Verified payments arriving after cancellation, expiry, rescheduling, or a balance change are retained as `PayHereCheckout.status=REVIEW` with the reason and provider reference, without changing the booking balance or taking an occupied slot. Reconcile these exceptions with the provider before any manual adjustment. Chargebacks are also retained for reconciliation; automatic refunds and a gateway reconciliation screen are outside this change.

Provider reference: [PayHere Checkout API](https://support.payhere.lk/api-%26-mobile-sdk/checkout-api).

## Deployment

Apply migrations using `npm.cmd run db:deploy` before starting the new backend. Migrations add PaymentSettings, BankTransferSlip, PayHereCheckout, optional legacy attachment bytes, folder storage paths, and encrypted gateway credentials/snapshots. No existing booking or invoice data is rewritten.

Set `CUSTOMER_TENANT_SLUG` on the web process and optional `CUSTOMER_BRANCH_ID` for runtime configuration. The dynamic booking page passes them to the portal at request time. The existing `NEXT_PUBLIC_CUSTOMER_TENANT_SLUG` and `NEXT_PUBLIC_CUSTOMER_BRANCH_ID` remain build-time fallbacks; Docker Compose supplies runtime overrides automatically from those settings. The local demo uses `techwing-auth-sample` in ignored `web/.env.local`. Set `BOOKING_API_INTERNAL_ORIGIN` to the NestJS origin for server session validation. Nginx routes the exact `/api/session` path to Next.js, and remaining `/api/` paths, including payment notifications and attachments, to NestJS. Keep the configured upload limit at least 5 MB plus multipart overhead; the included configuration allows 10 MB.

Files are bounded to 5 MB each. Set `ATTACHMENTS_DIR` to a private writable directory. Docker supplies `/app/uploads` backed by the persistent `uploads` volume. Back up this volume together with PostgreSQL and preserve the encryption key. The folder is not exposed as a static public URL. Legacy attachment bytes remain in database backups.

The active local preview uses clean database `strikzclub_local`, tenant `strikzclub-homagama`, one administrator, one staff member, and Full Turf. Initial local test pricing is LKR 3,000/hour with 14 days of hourly slots; replace it with the club’s approved pricing. The initial policy forfeits received funds under 6 hours, charges 25% from 6 hours, and is free strictly over 24 hours; review and publish the club’s actual policy before production. Older sample data remains in a separate test database. No remote production data has been reset.

Customer and staff sessions use separate HttpOnly cookies. The public calendar API and public Socket.IO room expose only availability and empty refresh signals. Player history remains authenticated and restricted to the owner. Public pages contain no staff dashboard links; staff open `/login` directly.

## Verification

Run backend build and web typecheck/build normally. The integration script refuses any database except local `techwing_auth_sample`:

```powershell
npm.cmd run build
node --env-file=.sample-auth/api.env scripts/check-customer-payments.cjs
```

Alternatively, set `DATABASE_URL` and `JWT_SECRET` for that sample database and run `npm.cmd run test:customer-payments`. The script creates isolated fixture tenants, starts an ephemeral local API, performs 89 HTTP checks plus Socket.IO and encryption/storage checks, and deactivates the fixture accounts at completion. It sends no request to PayHere and performs no real transfer. It checks public privacy, staff attribution, tenant isolation, file validation and size, encrypted settings and credential rotation, concurrent approval and notification replay, rejected and expired payments, slot conflicts, amount/currency/signature checks, late payment reconciliation, and invoice balances.

For the running clean local preview, set `STRIKZ_TEST_PASSWORD` to the local administrator password and run `node --env-file=.local-strikz/api.env scripts/check-session-isolation.cjs`. This performs 20 HTTP checks covering independent customer/staff login and logout, protected dashboards, the public booking page, and favicon. It removes its one temporary unbooked player after checking.

For a manual check, configure bank details as admin, register a player, reserve an available calendar session, and upload a test slip. Sign in as Nimal or another payment staff member and approve it from All bookings. The player’s booking should show Paid after refresh. Repeat with rejection and verify the balance remains unpaid. With actual sandbox credentials configured, complete PayHere’s sandbox checkout and verify the booking updates after its server notification.
