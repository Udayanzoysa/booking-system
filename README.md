# Indoor Cricket Arena Booking API

## Local setup

Use Node.js 22.12 or newer and an empty PostgreSQL database. Copy `.env.example` to `.env`. Set `DATABASE_URL`, a random `JWT_SECRET` of at least 32 bytes, and the `BOOTSTRAP_…` values. For the Strikz Club setup, provide `BOOTSTRAP_ADMIN_PASSWORD` and `BOOTSTRAP_STAFF_PASSWORD` in the shell.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run db:deploy
npm.cmd run db:strikz-setup
Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD,Env:BOOTSTRAP_STAFF_PASSWORD
npm.cmd start
```

The Strikz setup creates `strikzclub-homagama`, one administrator, one staff member, the Pitipana branch, Full Turf, and a cancellation policy. No synthetic customers, bookings, or invoices are created. Existing arenas are preserved on rerun. Optional `BOOTSTRAP_PRICE_PER_HOUR` creates initial pricing and hourly slots from 07:00–22:00 for `BOOTSTRAP_SCHEDULE_DAYS` days; otherwise configure prices and hours in the dashboard. Review the initial cancellation terms before accepting customers. The generic `db:bootstrap` command remains available for other tenants.

## First booking

1. Sign in with `POST /api/auth/login` using `tenantSlug`, `email`, and `password`. Send the resulting token as `Authorization: Bearer <token>` on authenticated requests. Staff accounts and assignments are managed through `/api/users` and `/api/rbac`.
2. Create a branch via `POST /api/branches` and assign an active booking staff member as `webLeadOwnerId` for web bookings. Use `POST /api/lanes` to add a lane, `PUT /api/lanes/:laneId/pricing` to configure rates, and `POST /api/lanes/:laneId/slots` to schedule slots.
3. Publish cancellation terms via `POST /api/cancellation-policies`. Add staff shifts via `POST /api/branches/:branchId/roster`.
4. Register a web customer via `POST /api/auth/register` or create an assisted-booking customer via `POST /api/customers`. Check availability at `GET /api/branches/:branchId/availability` with `startsAt` and `endsAt` query parameters. Create the reservation via `POST /api/bookings`.

Request times use ISO 8601 with an explicit UTC offset. Money values use decimal strings. For staff-recorded payments, provide a UUID idempotency key and reuse it on retries of the same settlement. Collection and refund endpoints record settlements already verified by staff. Customers can pay from their wallet through the API.

The Socket.IO namespace `/availability` accepts the access token in `auth.token`, or a public read-only subscription using `auth.tenantSlug`. Public subscribers join a separate room and receive only the empty `availability.changed` signal. Treat the event as a signal to refresh availability over HTTP. The scaffold uses in-process socket delivery.

## Techwing Arena frontend

In a second terminal, run:

```powershell
Set-Location web
npm.cmd ci
npm.cmd run dev
```

Open [the Strikz Club homepage](http://localhost:3001). **Book your slot** opens the customer booking page at `/book`. The [staff booking calendar](http://localhost:3001/dashboard) redirects to `/login` until a staff member signs in. Each dashboard section requires its matching permission.

Set `CUSTOMER_TENANT_SLUG=strikzclub-homagama` in `web/.env.local`; optional `CUSTOMER_BRANCH_ID` selects the branch. Existing `NEXT_PUBLIC_CUSTOMER_*` variables remain build-time fallbacks. Customers use `techwing-customer-session` and staff use `techwing-session`, so signing out of one portal leaves the other session intact. Public pages contain no staff dashboard links; staff use `/login` directly.

If your API is on another origin, set `NEXT_PUBLIC_BOOKING_API_ORIGIN` in `web/.env.local` and match `FRONTEND_ORIGIN` in the backend environment to the web origin. Set the server-side `BOOKING_API_INTERNAL_ORIGIN` to the reachable NestJS origin for session validation. Docker Compose supplies `http://api:3000`. Restart the affected servers after configuration changes. Docker builds accept the customer tenant and branch values from the matching Compose environment variables. Nginx routes `/api/session` to the frontend and the remaining API paths to NestJS.

### Customer calendar and payments

The public `/book` calendar shows Full Turf before sign-in. Fully paid slots show **Already booked**. Held or deposit-paid slots open **Available · Call club** inquiries without permitting a second online reservation. Available slots prompt sign-in when reserving. My bookings shows total, paid, balance due, hold expiry, slip review status, and direct **Pay / Upload slip** actions.

Bank account details are managed by an administrator at `/dashboard/payments`. Players can attach a JPG, PNG, or PDF transfer slip up to 5 MB. Staff with `RECORD_PAYMENT` review slips in **All bookings → Bank transfer reviews**. Quick booking and payment collection also accept attachments: staff can record verified funds immediately or save a pending slip. Uploading a customer or pending staff slip does not extend its expiry. Private files are stored under `ATTACHMENTS_DIR/bookings/<bookingId>/`; Docker mounts the persistent `uploads` volume.

PayHere uses its sandbox only. Set a stable base64-encoded 32-byte `PAYMENT_SETTINGS_ENCRYPTION_KEY` on the backend, then enter and enable the sandbox merchant credentials, notification URL, return origin, and club phone in **Payment settings**. Secrets are encrypted and never returned to the browser. Legacy backend environment configuration remains a fallback until an administrator saves gateway settings. The notification URL must be publicly reachable over HTTPS. Only signed notifications confirm payment; callbacks retain their encrypted checkout credential snapshot across later credential changes.

See [customer payment setup and manual checks](docs/customer-booking-payments.md) for deployment and testing. Run `npm.cmd run build` and then `npm.cmd run test:customer-payments` against the local `techwing_auth_sample` database for the integration checks.

### Google player sign-in

The player account dialog includes **Continue with Google**. Set backend `GOOGLE_CLIENT_ID` to a Google OAuth Web client ID and register the exact frontend origins in Google Cloud. The supplied client ID is configured in the ignored local Strikz environment. No Google client secret is required. Existing password users sign in normally and choose **Connect Google** to link the matching Google account. Google sessions remain customer-only and use the separate player cookie.

See [Google sign-in setup](docs/google-sign-in.md) for Google Cloud origins and testing. Run `npm.cmd run test:google-auth` against the local sample database for the verifier and account integration checks.

### Booking invoices

Run `npm.cmd run db:deploy` to apply the booking invoice migration. Arena staff with `MANAGE_INVOICES` can issue invoices for confirmed or completed lane bookings from **Invoices**. The migration grants this permission to existing Administrator roles that already have `MANAGE_RBAC`. Booking payments appear automatically on the invoice. Use the receipt action for an individual collection and the browser’s **Print or save PDF** button for a copy.

Issued invoices keep the original booking details. Cancellations and lower prices create a credit note when needed. For higher-priced changes, reschedule before issuing an invoice. Staff can record a received payment on the invoice after the session. Use the existing booking refund action to record a refund after issuing a credit note.

### Sample admin and staff sign-in

The active local Strikz preview uses the separate `strikzclub_local` database. Sign in at `/login` with arena `strikzclub-homagama`, `admin@strikzclub.test` or `staff@strikzclub.test`, and local-only password `Strikz-Local-Test-2026!`. The older `techwing_auth_sample` database below is retained separately for automated tests and is not used by the clean arena.

For a fresh test setup, create a local PostgreSQL database named `techwing_auth_sample`. Point `DATABASE_URL` at that database, apply migrations, build the backend, and run `npm.cmd run db:sample-auth`. The seed creates the sample tenant once. Later runs preserve account and permission edits.

On `/login`, use `techwing-auth-sample` as the arena slug and `Techwing-Local-Test-2026!` as the sample password. Sign in as `admin@example.test` to manage roles and access all staff functions. Sign in as `staff@example.test` to manage bookings and customers, create unpaid holds, and record payments. Use **Staff & roles** with the admin account to grant or remove permissions.

Run `npm.cmd run db:sample-bookings` after the auth seed to add **Sample Training Arena**, 100 synthetic customers, 1,000 linked bookings and invoices, and two Booking Staff users. Sign in as `nimal@example.test` or `kamal@example.test` with the same sample password. The fixture includes paid, deposit, and unpaid balances, and a mix of historical and upcoming bookings. To test a payment status change, open an upcoming unpaid booking and record a received payment. An admin can also collect against a historical invoice from **Invoices**. The seed runs once per sample tenant and preserves later edits.

Use **Sign out** to switch between sample accounts. Keep `TECHWING_QUICK_DEMO` disabled when testing the protected login flow.
