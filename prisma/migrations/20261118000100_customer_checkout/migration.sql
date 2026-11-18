CREATE TYPE "BankTransferSlipStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "PayHereCheckoutStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REVIEW');

CREATE TABLE "PaymentSettings" (
  "tenantId" UUID NOT NULL,
  "bankTransferEnabled" BOOLEAN NOT NULL DEFAULT false,
  "bankName" TEXT NOT NULL DEFAULT '',
  "accountName" TEXT NOT NULL DEFAULT '',
  "accountNumber" TEXT NOT NULL DEFAULT '',
  "bankBranch" TEXT NOT NULL DEFAULT '',
  "instructions" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PaymentSettings_pkey" PRIMARY KEY ("tenantId")
);

CREATE TABLE "BankTransferSlip" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "submittedById" UUID NOT NULL,
  "reviewedById" UUID,
  "idempotencyKey" TEXT NOT NULL,
  "amount" DECIMAL(14,4) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "reference" TEXT,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "fileSha256" TEXT NOT NULL,
  "attachment" BYTEA NOT NULL,
  "status" "BankTransferSlipStatus" NOT NULL DEFAULT 'PENDING',
  "reviewNote" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMPTZ(3),
  CONSTRAINT "BankTransferSlip_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BankTransferSlip_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "BankTransferSlip_size_limit" CHECK ("fileSize" > 0 AND "fileSize" <= 5242880 AND octet_length("attachment") = "fileSize")
);

CREATE TABLE "PayHereCheckout" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "bookingId" UUID NOT NULL,
  "initiatedById" UUID NOT NULL,
  "slotId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "amount" DECIMAL(14,4) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "merchantId" TEXT NOT NULL,
  "paymentId" TEXT,
  "status" "PayHereCheckoutStatus" NOT NULL DEFAULT 'PENDING',
  "statusCode" TEXT,
  "reviewNote" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PayHereCheckout_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayHereCheckout_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "BankTransferSlip_tenantId_idempotencyKey_key" ON "BankTransferSlip"("tenantId", "idempotencyKey");
CREATE INDEX "BankTransferSlip_tenantId_status_createdAt_idx" ON "BankTransferSlip"("tenantId", "status", "createdAt");
CREATE INDEX "BankTransferSlip_tenantId_bookingId_createdAt_idx" ON "BankTransferSlip"("tenantId", "bookingId", "createdAt");
CREATE UNIQUE INDEX "PayHereCheckout_paymentId_key" ON "PayHereCheckout"("paymentId");
CREATE UNIQUE INDEX "PayHereCheckout_tenantId_idempotencyKey_key" ON "PayHereCheckout"("tenantId", "idempotencyKey");
CREATE INDEX "PayHereCheckout_tenantId_bookingId_createdAt_idx" ON "PayHereCheckout"("tenantId", "bookingId", "createdAt");
CREATE INDEX "PayHereCheckout_tenantId_status_createdAt_idx" ON "PayHereCheckout"("tenantId", "status", "createdAt");

ALTER TABLE "PaymentSettings" ADD CONSTRAINT "PaymentSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankTransferSlip" ADD CONSTRAINT "BankTransferSlip_tenantId_bookingId_fkey" FOREIGN KEY ("tenantId", "bookingId") REFERENCES "Booking"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankTransferSlip" ADD CONSTRAINT "BankTransferSlip_tenantId_submittedById_fkey" FOREIGN KEY ("tenantId", "submittedById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankTransferSlip" ADD CONSTRAINT "BankTransferSlip_tenantId_reviewedById_fkey" FOREIGN KEY ("tenantId", "reviewedById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayHereCheckout" ADD CONSTRAINT "PayHereCheckout_tenantId_bookingId_fkey" FOREIGN KEY ("tenantId", "bookingId") REFERENCES "Booking"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayHereCheckout" ADD CONSTRAINT "PayHereCheckout_tenantId_initiatedById_fkey" FOREIGN KEY ("tenantId", "initiatedById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
