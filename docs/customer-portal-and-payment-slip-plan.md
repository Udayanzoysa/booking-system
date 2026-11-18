# Implementation Plan: Strikz Club Booking Simplification, Customer Portal, Slip Folder Storage, and Admin PayHere Setup

**Status** — Implemented locally. Production migration/cutover and any destructive cleanup of the remote database remain separate deployment work.

The local preview now uses a separate clean `strikzclub_local` database with tenant `strikzclub-homagama`, one Admin, one Staff, and Full Turf. Older sample fixtures are retained only in the separate test database. See [setup and verification](customer-booking-payments.md). Backend and frontend builds passed, along with 89 payment/public API checks and 20 session-isolation checks. Browser visual verification was unavailable in this chat.

---

## 1. Confirmed Business & UI Requirements

1. **Arena & clean production data (`strikzclub-homagama`):**
   - Arena / tenant slug: **`strikzclub-homagama`** (e.g., `Strikz Club - Homagama`, currency `LKR`, branch `Pitipana, Homagama`).
   - Keep **1 default Admin** and **1 Staff member** only for the booking system (plus player accounts registered on `/book`).
   - Remove all synthetic testing/sample fixtures (`Sample Training Arena`, `Sample Turf Net`, `Bowling Machine 1/2`, 100 synthetic customers, 1,000 synthetic bookings/invoices, and extra demo staff accounts).
2. **Indoor Ground / Full Turf only (no lanes, no bowling machine):**
   - Both Staff (`/dashboard`) and Customer (`/book`) calendars represent the **Indoor Ground (Full Turf)** only—remove `"Turf net"`, `"Bowling machine"`, and the `"All lane types"` filter dropdown from `web/components/Calendar.tsx`, `web/components/club/CustomerCalendar.tsx`, and `web/components/club/CustomerPortal.tsx`.
   - In **Quick booking** (`web/components/BookingDialog.tsx`), remove the `Lane` selection requirement (auto-select the single **Full Turf** ground when creating a booking).
3. **Quick booking field rules (`web/components/BookingDialog.tsx`):**
   - **Lead owner:**
     - When **Admin** is logged in: default `Lead owner` to the signed-in **Admin** (editable if reassigning).
     - When **Staff** is logged in: **hide** the `Lead owner` dropdown and automatically assign the signed-in staff member.
     - When a **direct customer** books online (`/book`): mark/display as **Web** (`leadSource: WEB`).
   - **Lead source:** **Hide** the `Lead source` selector in Quick booking for now (defaulting backend `leadSource` for staff/admin creations, and `WEB` for direct customer bookings).
   - **Payment method — Bank transfer attachment:** When `Payment method` is `Bank transfer`, allow attaching a slip file (**JPG, PNG, or PDF under 5 MB**) directly in Quick booking / payment collection as well as in customer checkout.
4. **Separate Customer Login & Hidden Staff/Admin UI:**
   - Remove all public `Staff dashboard` links from `web/components/club/ClubLanding.tsx` and `web/components/club/CustomerPortal.tsx` so customers never see staff/admin navigation.
   - Keep staff access strictly at `/login` and `/dashboard` (guarded by `requireDashboardSession()` in `web/lib/server-auth.ts`, redirecting players to `/book`).
   - Isolate customer and staff session cookies so customer and staff logins do not interfere with each other.
5. **Separate Customer & Staff Calendar Views Sharing Common Data:**
   - Both views share the same PostgreSQL tables (`SlotSchedule`, `Booking`, `PaymentTransaction`, `BankTransferSlip`, `PaymentSettings`, `PayHereCheckout`) and Socket.IO `/availability` updates.
   - **Customer view (`/book`):**
     - **Paid bookings (`PAID`):** Show a simple **`Already booked`** state (no other customer's private info).
     - **Unpaid / deposit-pending bookings (`HELD` / `RESERVED`):** Make the slot selectable to show an inquiry prompt (`Available · Call club`) with a clickable club phone number (`070 126 1966` / `tel:+94701261966`).
     - **My bookings:** After customer sign-in, show current & upcoming bookings with full payment info (`Total`, `Paid`, `Balance due`, slip review status) and a direct **Pay / Upload slip** button for upcoming bookings that are not yet fully paid.
6. **Bank Transfer Slip Storage in Booking Folder (Under 5 MB):**
   - Store uploaded slip attachments (JPG/PNG/PDF, max **5 MB**) on disk inside a per-booking folder (e.g., `ATTACHMENTS_DIR/bookings/<bookingId>/<slipId>.<ext>`), mounted as a persistent Docker volume in `docker-compose.yml` and served only through authenticated backend download checks (`GET /api/payments/bank-transfer-slips/:id/attachment`).
7. **Admin PayHere Sandbox Setup in Admin UI:**
   - Keep PayHere sandbox support (`https://sandbox.payhere.lk/pay/checkout`), and allow the **Admin** in **Dashboard → Payment settings** (`/dashboard/payments`, `web/components/PaymentSettings.tsx`) to enter, save, and enable/disable PayHere credentials (`merchantId`, encrypted `merchantSecret`, `notifyUrl`, `returnOrigin`, sandbox/live mode) directly in the admin portal without editing `.env`.
8. **Tennis Ball Favicon:**
   - Add a **tennis ball** favicon (`web/app/icon.svg` and metadata in `web/app/layout.tsx`) across all routes (`/`, `/book`, `/login`, `/dashboard`).

---

## 2. Detailed Implementation Plan

### Phase 1 — Schema, Migrations & Attachment Folder Storage
1. **Prisma schema updates (`prisma/schema.prisma`) + new migration:**
   - **`PaymentSettings`:** Add per-tenant PayHere & contact fields:
     - `payhereEnabled` (`Boolean`, default `false`)
     - `payhereSandbox` (`Boolean`, default `true`)
     - `payhereMerchantId` (`String`, default `""`)
     - `payhereMerchantSecretEncrypted` (`String`, default `""` — AES-256-GCM encrypted at rest, never returned in API responses)
     - `payhereNotifyUrl` (`String`, default `""`)
     - `payhereReturnOrigin` (`String`, default `""`)
     - `contactPhone` (`String`, default `""`)
   - **`BankTransferSlip`:** Add `storagePath` (`String?`) and make `attachment` (`Bytes?`) optional so new slips are stored in `<ATTACHMENTS_DIR>/bookings/<bookingId>/<slipId>.<ext>` (while remaining backward-compatible for any legacy DB-byte records).
2. **Backend attachment storage helper (`src/payments/slip-storage.ts`):**
   - Resolve `ATTACHMENTS_DIR` (default `path.resolve(process.cwd(), 'uploads')`), enforce `fileSize <= 5 * 1024 * 1024` and magic-byte validation (`safeAttachment` in `src/payments/payhere.ts` for JPG/PNG/PDF), write atomically under `bookings/<bookingId>/`, and prevent path traversal when reading.
   - Update `docker-compose.yml` to mount a persistent volume (e.g., `uploads:/app/uploads`) on `api` and set `ATTACHMENTS_DIR=/app/uploads`.
3. **Staff & customer slip endpoints (`src/payments/`):**
   - Keep `POST /api/payments/:bookingId/bank-transfer-slips` (supporting **both** the booking owner and staff with `RECORD_PAYMENT` / `MANAGE_BOOKINGS` so staff can upload a slip right from Quick booking or payment collection!).
   - When staff attaches a slip during Quick booking or staff payment collection: support saving the slip in the booking's `bookings/<bookingId>/` folder and recording/linking the `BANK_TRANSFER` collection (or pending slip review as selected).

### Phase 2 — Arena Cleanup (`strikzclub-homagama`) & Single-Ground ("Indoor Ground / Full Turf") Model
1. **Clean bootstrap / seed scripts (`src/bootstrap-tenant.ts` & clean setup script):**
   - Configure default arena slug **`strikzclub-homagama`** (`Strikz Club - Homagama`, `LKR`, branch `Pitipana, Homagama`, single ground **`Full Turf`** with type `TURF_NET` and label `Indoor Ground`).
   - Provision **1 default Admin** and **1 Staff member** (`Booking Staff` role with booking/payment/customer permissions, without admin RBAC/settings permissions).
   - Remove all synthetic sample data from production setup (`Sample Training Arena`, `Sample Turf Net`, `Bowling Machine 1/2`, `Nimal`, `Kamal`, 100 synthetic customers, 1,000 synthetic bookings/invoices).
2. **Remove lane/bowling-machine UI across calendars (`web/components/`):**
   - `web/components/Calendar.tsx`: Remove the `All lane types` (`Turf net` / `Bowling machine`) filter and display **`Indoor Ground`** instead of `"Turf net"` / `"Bowling machine"`.
   - `web/components/club/CustomerCalendar.tsx` & `CustomerPortal.tsx`: Remove the `Lane type` (`Turf net` / `Bowling machine`) filter and display **`Indoor Ground`** / **`Full Turf`**.
   - `web/components/Operations.tsx`: Update ground/lane labels cleanly to Indoor Ground / Full Turf (while preserving underlying API compatibility).

### Phase 3 — Staff Quick Booking Modal (`web/components/BookingDialog.tsx`)
1. **No Lane selector:** Automatically select the single **Full Turf** ground (if only 1 ground exists in the branch, hide the `Lane` dropdown and show a compact read-only label or omit it; keep fallback only if multiple grounds ever exist).
2. **Hide `Lead source`:** Remove the `Lead source` dropdown from the Quick booking UI and automatically pass a default (`WALK_IN` for staff/admin bookings; `WEB` for direct customer bookings).
3. **Role-aware `Lead owner`:**
   - Detect Admin vs. Staff (e.g., `permissions.includes('MANAGE_RBAC') || permissions.includes('MANAGE_USERS')`).
   - **Admin logged in:** Show `Lead owner` defaulted to `currentUser.id` (the signed-in Admin).
   - **Staff logged in:** Hide the `Lead owner` field and automatically set `leadOwnerId = currentUser.id`.
   - **Direct customer (`/book`):** Backend continues setting `leadSource = WEB` (displayed as `Web` in staff booking details).
4. **Bank transfer slip upload (< 5 MB) in Quick booking:**
   - When `Payment method` = `Bank transfer` (for Full payment or Deposit), display a file upload input (`JPG, PNG, PDF up to 5 MB`) inside Quick booking and the payment collection form, uploading to `/api/payments/:bookingId/bank-transfer-slips` into the `bookings/<bookingId>/` folder.

### Phase 4 — Customer Portal, Separate Login & Calendar Availability Rules
1. **Hide Staff/Admin navigation:**
   - Remove `<Link href="/dashboard">Staff dashboard</Link>` from `web/components/club/ClubLanding.tsx` and `web/components/club/CustomerPortal.tsx`.
   - Separate customer session cookie (`techwing-customer-session`) from staff session cookie (`techwing-session`) in `web/lib/server-auth.ts` and `web/app/api/session/route.ts`.
2. **Public read-only availability + separate customer login (`/book`):**
   - Add public read-only availability endpoint (`GET /api/public/tenants/:slug/branches/:branchId/availability`) returning non-PII slot availability (`AVAILABLE`, `PAID` -> `Already booked`, `HELD`/`RESERVED` -> `Call to book`, `MAINTENANCE`).
   - Show the live **Indoor Ground** calendar on `/book` immediately; prompt customer sign-in / registration when reserving a slot or opening **My bookings**.
3. **Customer calendar slot behavior (`CustomerCalendar.tsx` & `LanesService.availability`):**
   - **`PAID`:** Rendered as **`Already booked`** (disabled, no customer details).
   - **`HELD` / `RESERVED` (unpaid or deposit-pending):** Rendered as **`Available · Call club`** (selectable); clicking opens a modal showing slot time, price, and a clickable **`Call 070 126 1966`** (`tel:+94701261966`, using `contactPhone` from `PaymentSettings`).
   - **`AVAILABLE`:** Normal online booking flow → reserve slot → upload bank slip or pay via PayHere sandbox.
4. **Customer "My bookings" payment info & slip upload:**
   - Show `Total`, `Paid`, `Balance due`, hold expiry, and latest bank slip status (`Awaiting review` / `Approved` / `Rejected` + review note) on each booking item.
   - Add a direct **`Pay / Upload slip`** button for all upcoming bookings with `balanceDue > 0`.

### Phase 5 — Admin PayHere Configuration UI & Tennis Ball Favicon
1. **Admin Payment Settings (`web/components/PaymentSettings.tsx` + `CustomerPaymentsService`):**
   - Add a **PayHere** configuration form in `/dashboard/payments` (`MANAGE_TENANT`) for Sandbox/Live mode, Merchant ID, Merchant Secret (encrypted in DB, masked on reload), Notify URL, Return Origin, and Club Contact Phone.
   - Update `CustomerPaymentsService.gatewayConfig(tenantId)` and `notify()` to load per-tenant DB credentials first and fall back to `.env`.
2. **Tennis ball favicon (`web/app/icon.svg` & `web/app/layout.tsx`):**
   - Create a crisp tennis ball SVG icon at `web/app/icon.svg` and wire icon metadata in `web/app/layout.tsx` so Next.js serves it across all pages.

---

## 3. Implementation Decisions

1. **Staff slips:** Verified funds are recorded immediately by default and the slip is saved in the booking folder. Staff may instead choose pending review. Customer uploads always remain pending. Payment permission is enforced on the backend.
2. **Calendar:** Both unpaid holds and deposit-paid reservations show **Available · Call club**. Fully paid bookings show **Already booked**. The inquiry action cannot create a competing online reservation.
3. **Hold expiry:** The existing expiry remains in effect. An unverified upload does not extend or indefinitely protect a hold. Customer checkout displays the deadline, and staff cannot approve an expired or unavailable booking.
4. **Clean setup:** `db:strikz-setup` provisions one Admin, one Staff, Pitipana/Homagama, Full Turf, and customer permissions without sample bookings. The active local preview was switched to a fresh database. No remote production reset was executed. Bootstrap reruns preserve existing accounts and business data.

5. **PayHere:** Admin setup is implemented with encrypted secrets and credential snapshots. Execution remains sandbox-only, matching the current sandbox requirement; the UI labels live mode unavailable. A stable encryption key is infrastructure configuration, while bank and merchant details are managed in the application.
