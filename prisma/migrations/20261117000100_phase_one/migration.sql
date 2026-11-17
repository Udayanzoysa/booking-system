-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LaneType" AS ENUM ('TURF_NET', 'BOWLING_MACHINE');

-- CreateEnum
CREATE TYPE "SlotKind" AS ENUM ('BOOKABLE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "PricingTier" AS ENUM ('PEAK', 'OFF_PEAK');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WHATSAPP', 'PHONE', 'WALK_IN', 'WEB');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('HELD', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "BookingPaymentStatus" AS ENUM ('UNPAID', 'DEPOSIT_PAID', 'FULLY_PAID');

-- CreateEnum
CREATE TYPE "PaymentTransactionType" AS ENUM ('COLLECTION', 'REFUND', 'WALLET_CREDIT');

-- CreateEnum
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'ONLINE_GATEWAY', 'WALLET');

-- CreateEnum
CREATE TYPE "CancellationFeeType" AS ENUM ('FREE', 'PERCENT_OF_BOOKING_TOTAL', 'FIXED', 'FORFEIT_PAID_AMOUNT');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "unpaidHoldMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "webLeadOwnerId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lane" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LaneType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Lane_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LanePricingRule" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "laneId" UUID NOT NULL,
    "tier" "PricingTier" NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "pricePerHour" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LanePricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotSchedule" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "laneId" UUID NOT NULL,
    "kind" "SlotKind" NOT NULL DEFAULT 'BOOKABLE',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SlotSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("tenantId","userId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "tenantId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("tenantId","roleId","permissionId")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "walletBalance" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "cancellationPolicyId" UUID NOT NULL,
    "leadSource" "LeadSource" NOT NULL,
    "leadOwnerId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "headcount" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'HELD',
    "paymentStatus" "BookingPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "currency" CHAR(3) NOT NULL,
    "totalAmount" DECIMAL(14,4) NOT NULL,
    "depositRequired" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "holdExpiresAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledById" UUID,
    "cancellationFee" DECIMAL(14,4),
    "cancellationReason" TEXT,
    "isAiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiConfidenceScore" DOUBLE PRECISION,
    "conversationId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingReschedule" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "previousSlotId" UUID NOT NULL,
    "newSlotId" UUID NOT NULL,
    "changedById" UUID NOT NULL,
    "previousTotal" DECIMAL(14,4) NOT NULL,
    "newTotal" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingReschedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "recordedById" UUID,
    "type" "PaymentTransactionType" NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "provider" TEXT,
    "providerReference" TEXT,
    "processedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationPolicy" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "allowWalletCredit" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CancellationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationPolicyTier" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "cancellationPolicyId" UUID NOT NULL,
    "minimumNoticeMinutes" INTEGER NOT NULL,
    "minimumInclusive" BOOLEAN NOT NULL DEFAULT true,
    "feeType" "CancellationFeeType" NOT NULL,
    "feeValue" DECIMAL(14,4),

    CONSTRAINT "CancellationPolicyTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffRoster" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StaffRoster_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Branch_tenantId_webLeadOwnerId_idx" ON "Branch"("tenantId", "webLeadOwnerId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_tenantId_id_key" ON "Branch"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_tenantId_code_key" ON "Branch"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Lane_tenantId_branchId_type_isActive_idx" ON "Lane"("tenantId", "branchId", "type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Lane_tenantId_id_key" ON "Lane"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Lane_tenantId_branchId_name_key" ON "Lane"("tenantId", "branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "LanePricingRule_tenantId_laneId_dayOfWeek_startMinute_key" ON "LanePricingRule"("tenantId", "laneId", "dayOfWeek", "startMinute");

-- CreateIndex
CREATE UNIQUE INDEX "SlotSchedule_tenantId_id_key" ON "SlotSchedule"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SlotSchedule_tenantId_laneId_startsAt_endsAt_kind_key" ON "SlotSchedule"("tenantId", "laneId", "startsAt", "endsAt", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_id_key" ON "User"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_tenantId_id_key" ON "Role"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Role_tenantId_name_key" ON "Role"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_tenantId_id_key" ON "Permission"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_tenantId_code_key" ON "Permission"("tenantId", "code");

-- CreateIndex
CREATE INDEX "UserRole_tenantId_roleId_idx" ON "UserRole"("tenantId", "roleId");

-- CreateIndex
CREATE INDEX "RolePermission_tenantId_permissionId_idx" ON "RolePermission"("tenantId", "permissionId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_phone_idx" ON "Customer"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_id_key" ON "Customer"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_userId_key" ON "Customer"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "Booking_tenantId_slotId_status_holdExpiresAt_idx" ON "Booking"("tenantId", "slotId", "status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "Booking_status_holdExpiresAt_idx" ON "Booking"("status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "Booking_tenantId_customerId_createdAt_idx" ON "Booking"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_tenantId_leadOwnerId_createdAt_idx" ON "Booking"("tenantId", "leadOwnerId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_tenantId_creatorId_idx" ON "Booking"("tenantId", "creatorId");

-- CreateIndex
CREATE INDEX "Booking_tenantId_cancelledById_idx" ON "Booking"("tenantId", "cancelledById");

-- CreateIndex
CREATE INDEX "Booking_tenantId_cancellationPolicyId_idx" ON "Booking"("tenantId", "cancellationPolicyId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_tenantId_id_key" ON "Booking"("tenantId", "id");

-- CreateIndex
CREATE INDEX "BookingReschedule_tenantId_bookingId_createdAt_idx" ON "BookingReschedule"("tenantId", "bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingReschedule_tenantId_previousSlotId_idx" ON "BookingReschedule"("tenantId", "previousSlotId");

-- CreateIndex
CREATE INDEX "BookingReschedule_tenantId_newSlotId_idx" ON "BookingReschedule"("tenantId", "newSlotId");

-- CreateIndex
CREATE INDEX "BookingReschedule_tenantId_changedById_idx" ON "BookingReschedule"("tenantId", "changedById");

-- CreateIndex
CREATE INDEX "PaymentTransaction_tenantId_bookingId_createdAt_idx" ON "PaymentTransaction"("tenantId", "bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentTransaction_tenantId_recordedById_idx" ON "PaymentTransaction"("tenantId", "recordedById");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_tenantId_idempotencyKey_key" ON "PaymentTransaction"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_tenantId_provider_providerReference_key" ON "PaymentTransaction"("tenantId", "provider", "providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationPolicy_tenantId_id_key" ON "CancellationPolicy"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationPolicy_tenantId_name_version_key" ON "CancellationPolicy"("tenantId", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationPolicyTier_tenantId_cancellationPolicyId_minimu_key" ON "CancellationPolicyTier"("tenantId", "cancellationPolicyId", "minimumNoticeMinutes");

-- CreateIndex
CREATE INDEX "StaffRoster_tenantId_branchId_startsAt_endsAt_idx" ON "StaffRoster"("tenantId", "branchId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "StaffRoster_tenantId_staffId_startsAt_endsAt_idx" ON "StaffRoster"("tenantId", "staffId", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "StaffRoster_tenantId_branchId_staffId_startsAt_endsAt_key" ON "StaffRoster"("tenantId", "branchId", "staffId", "startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_tenantId_webLeadOwnerId_fkey" FOREIGN KEY ("tenantId", "webLeadOwnerId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lane" ADD CONSTRAINT "Lane_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LanePricingRule" ADD CONSTRAINT "LanePricingRule_tenantId_laneId_fkey" FOREIGN KEY ("tenantId", "laneId") REFERENCES "Lane"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotSchedule" ADD CONSTRAINT "SlotSchedule_tenantId_laneId_fkey" FOREIGN KEY ("tenantId", "laneId") REFERENCES "Lane"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_tenantId_roleId_fkey" FOREIGN KEY ("tenantId", "roleId") REFERENCES "Role"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_tenantId_roleId_fkey" FOREIGN KEY ("tenantId", "roleId") REFERENCES "Role"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_tenantId_permissionId_fkey" FOREIGN KEY ("tenantId", "permissionId") REFERENCES "Permission"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tenantId_slotId_fkey" FOREIGN KEY ("tenantId", "slotId") REFERENCES "SlotSchedule"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tenantId_cancellationPolicyId_fkey" FOREIGN KEY ("tenantId", "cancellationPolicyId") REFERENCES "CancellationPolicy"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tenantId_leadOwnerId_fkey" FOREIGN KEY ("tenantId", "leadOwnerId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tenantId_creatorId_fkey" FOREIGN KEY ("tenantId", "creatorId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tenantId_cancelledById_fkey" FOREIGN KEY ("tenantId", "cancelledById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingReschedule" ADD CONSTRAINT "BookingReschedule_tenantId_bookingId_fkey" FOREIGN KEY ("tenantId", "bookingId") REFERENCES "Booking"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingReschedule" ADD CONSTRAINT "BookingReschedule_tenantId_previousSlotId_fkey" FOREIGN KEY ("tenantId", "previousSlotId") REFERENCES "SlotSchedule"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingReschedule" ADD CONSTRAINT "BookingReschedule_tenantId_newSlotId_fkey" FOREIGN KEY ("tenantId", "newSlotId") REFERENCES "SlotSchedule"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingReschedule" ADD CONSTRAINT "BookingReschedule_tenantId_changedById_fkey" FOREIGN KEY ("tenantId", "changedById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_tenantId_bookingId_fkey" FOREIGN KEY ("tenantId", "bookingId") REFERENCES "Booking"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_tenantId_recordedById_fkey" FOREIGN KEY ("tenantId", "recordedById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationPolicy" ADD CONSTRAINT "CancellationPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationPolicyTier" ADD CONSTRAINT "CancellationPolicyTier_tenantId_cancellationPolicyId_fkey" FOREIGN KEY ("tenantId", "cancellationPolicyId") REFERENCES "CancellationPolicy"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffRoster" ADD CONSTRAINT "StaffRoster_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffRoster" ADD CONSTRAINT "StaffRoster_tenantId_staffId_fkey" FOREIGN KEY ("tenantId", "staffId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep persisted ranges and financial values valid across every write path.
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_positive_hold_duration"
    CHECK ("unpaidHoldMinutes" > 0);
ALTER TABLE "LanePricingRule" ADD CONSTRAINT "LanePricingRule_valid_window_and_rate"
    CHECK (0 <= "startMinute" AND "startMinute" < "endMinute" AND "endMinute" <= 1440 AND "pricePerHour" >= 0);
ALTER TABLE "SlotSchedule" ADD CONSTRAINT "SlotSchedule_positive_duration"
    CHECK ("startsAt" < "endsAt");
ALTER TABLE "StaffRoster" ADD CONSTRAINT "StaffRoster_positive_duration"
    CHECK ("startsAt" < "endsAt");
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_nonnegative_wallet"
    CHECK ("walletBalance" >= 0);
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_valid_headcount_and_amounts"
    CHECK ("headcount" > 0 AND "totalAmount" >= 0 AND "depositRequired" >= 0 AND "amountPaid" >= 0 AND "cancellationFee" >= 0);
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_positive_amount"
    CHECK ("amount" > 0);
ALTER TABLE "CancellationPolicyTier" ADD CONSTRAINT "CancellationPolicyTier_valid_threshold_and_fee"
    CHECK ("minimumNoticeMinutes" >= 0 AND (
        ("feeType" IN ('FREE', 'FORFEIT_PAID_AMOUNT') AND "feeValue" IS NULL)
        OR ("feeType" = 'FIXED' AND "feeValue" IS NOT NULL AND "feeValue" >= 0)
        OR ("feeType" = 'PERCENT_OF_BOOKING_TOTAL' AND "feeValue" IS NOT NULL AND "feeValue" BETWEEN 0 AND 100)
    ));

