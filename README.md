# Indoor Cricket Arena Booking API

## Local setup

Use Node.js 22.12 or newer and an empty PostgreSQL database. Copy `.env.example` to `.env`. Set `DATABASE_URL`, a random `JWT_SECRET` of at least 32 bytes, and the `BOOTSTRAP_…` values. Set `BOOTSTRAP_ADMIN_PASSWORD` in the shell for the one-time administrator setup.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run db:deploy
npm.cmd run db:bootstrap
Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD
npm.cmd start
```

Each bootstrap run provisions a new tenant, administrator, and customer role. A repeated slug leaves the existing tenant and administrator intact.

## First booking

1. Sign in with `POST /api/auth/login` using `tenantSlug`, `email`, and `password`. Send the resulting token as `Authorization: Bearer <token>` on authenticated requests. Staff accounts and assignments are managed through `/api/users` and `/api/rbac`.
2. Create a branch via `POST /api/branches` and assign an active booking staff member as `webLeadOwnerId` for web bookings. Use `POST /api/lanes` to add a lane, `PUT /api/lanes/:laneId/pricing` to configure rates, and `POST /api/lanes/:laneId/slots` to schedule slots.
3. Publish cancellation terms via `POST /api/cancellation-policies`. Add staff shifts via `POST /api/branches/:branchId/roster`.
4. Register a web customer via `POST /api/auth/register` or create an assisted-booking customer via `POST /api/customers`. Check availability at `GET /api/branches/:branchId/availability` with `startsAt` and `endsAt` query parameters. Create the reservation via `POST /api/bookings`.

Request times use ISO 8601 with an explicit UTC offset. Money values use decimal strings. For staff-recorded payments, provide a UUID idempotency key and reuse it on retries of the same settlement. Collection and refund endpoints record settlements already verified by staff. Customers can pay from their wallet through the API.

The Socket.IO namespace `/availability` accepts the access token in the handshake `auth.token`. It emits `availability.changed` after changes for that tenant. Treat the event as a signal to refresh availability over HTTP. The scaffold uses in-process socket delivery.

## Techwing Arena frontend

In a second terminal, run:

```powershell
Set-Location web
npm.cmd ci
npm.cmd run dev
```

Open [the Strikz Club homepage](http://localhost:3001). **Book your slot** opens the customer booking page at `/book`. The [staff booking calendar](http://localhost:3001/dashboard) is at `/dashboard`. Select **Connect arena** in the staff workspace to sign into the backend.

Set `NEXT_PUBLIC_CUSTOMER_TENANT_SLUG` in `web/.env.local` to the venue tenant used for customer registration and bookings. Optionally set `NEXT_PUBLIC_CUSTOMER_BRANCH_ID` to select its branch. The local quick demo uses `techwing-auth-sample` when a customer tenant is omitted. Customer sessions are stored separately from staff sessions.

If your API is on another origin, set `NEXT_PUBLIC_BOOKING_API_ORIGIN` in `web/.env.local` and match `FRONTEND_ORIGIN` in the backend environment to the web origin. Restart the affected servers after configuration changes. Docker builds accept the customer tenant and branch values from the matching Compose environment variables.

### Booking invoices

Run `npm.cmd run db:deploy` to apply the booking invoice migration. Arena staff with `MANAGE_INVOICES` can issue invoices for confirmed or completed lane bookings from **Invoices**. The migration grants this permission to existing Administrator roles that already have `MANAGE_RBAC`. Booking payments appear automatically on the invoice. Use the receipt action for an individual collection and the browser’s **Print or save PDF** button for a copy.

Issued invoices keep the original booking details. Cancellations and lower prices create a credit note when needed. For higher-priced changes, reschedule before issuing an invoice. Staff can record a received payment on the invoice after the session. Use the existing booking refund action to record a refund after issuing a credit note.

### Sample admin and staff sign-in

For a fresh test setup, create a local PostgreSQL database named `techwing_auth_sample`. Point `DATABASE_URL` at that database, apply migrations, build the backend, and run `npm.cmd run db:sample-auth`. The seed creates the sample tenant once. Later runs preserve account and permission edits.

In **Connect arena**, use `techwing-auth-sample` as the arena slug and `Techwing-Local-Test-2026!` as the sample password. Sign in as `admin@example.test` to manage roles and access all staff functions. Sign in as `staff@example.test` to manage bookings and customers, create unpaid holds, and record payments. Use **Staff & roles** with the admin account to grant or remove permissions.

Run `npm.cmd run db:sample-bookings` after the auth seed to add **Sample Training Arena**, 100 synthetic customers, 1,000 linked bookings and invoices, and two Booking Staff users. Sign in as `nimal@example.test` or `kamal@example.test` with the same sample password. The fixture includes paid, deposit, and unpaid balances, and a mix of historical and upcoming bookings. To test a payment status change, open an upcoming unpaid booking and record a received payment. An admin can also collect against a historical invoice from **Invoices**. The seed runs once per sample tenant and preserves later edits.

For presentations, start the seeded local API with `TECHWING_QUICK_DEMO=1` and the matching local frontend with `NEXT_PUBLIC_TECHWING_QUICK_DEMO=1`. Open the exact loopback URL configured in `FRONTEND_ORIGIN`. The workspace opens as Sample Admin on the first visit and remembers the selected demo account. Use **Switch demo user** to switch between Admin, Nimal, and Kamal without entering a password. Quick sign-in requires the dedicated sample database and a loopback API and frontend.
