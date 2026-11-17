-- CreateTable
CREATE TABLE "InvoiceSequence" (
    "tenantId" UUID NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "issuedById" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT,
    "issuerName" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "branchTimeZone" TEXT NOT NULL,
    "laneName" TEXT NOT NULL,
    "serviceStartsAt" TIMESTAMPTZ(3) NOT NULL,
    "serviceEndsAt" TIMESTAMPTZ(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "totalAmount" DECIMAL(14,4) NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceCreditNote" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "issuedById" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceCreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invoice_tenantId_issuedAt_idx" ON "Invoice"("tenantId", "issuedAt");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_branchId_issuedAt_idx" ON "Invoice"("tenantId", "branchId", "issuedAt");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_customerId_issuedAt_idx" ON "Invoice"("tenantId", "customerId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_id_key" ON "Invoice"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_bookingId_key" ON "Invoice"("tenantId", "bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_number_key" ON "Invoice"("tenantId", "number");

-- CreateIndex
CREATE INDEX "InvoiceCreditNote_tenantId_invoiceId_issuedAt_idx" ON "InvoiceCreditNote"("tenantId", "invoiceId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceCreditNote_tenantId_number_key" ON "InvoiceCreditNote"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceCreditNote_tenantId_idempotencyKey_key" ON "InvoiceCreditNote"("tenantId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "InvoiceSequence" ADD CONSTRAINT "InvoiceSequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_bookingId_fkey" FOREIGN KEY ("tenantId", "bookingId") REFERENCES "Booking"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_issuedById_fkey" FOREIGN KEY ("tenantId", "issuedById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceCreditNote" ADD CONSTRAINT "InvoiceCreditNote_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "Invoice"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceCreditNote" ADD CONSTRAINT "InvoiceCreditNote_tenantId_issuedById_fkey" FOREIGN KEY ("tenantId", "issuedById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceSequence" ADD CONSTRAINT "InvoiceSequence_positive_number" CHECK ("nextNumber" > 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_valid_snapshot" CHECK ("number" > 0 AND "totalAmount" >= 0 AND "serviceEndsAt" > "serviceStartsAt");
ALTER TABLE "InvoiceCreditNote" ADD CONSTRAINT "InvoiceCreditNote_positive_amount" CHECK ("number" > 0 AND "amount" > 0);

INSERT INTO "Permission" ("id", "tenantId", "code")
SELECT gen_random_uuid(), "id", 'MANAGE_INVOICES' FROM "Tenant"
ON CONFLICT ("tenantId", "code") DO NOTHING;

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionId")
SELECT role."tenantId", role."id", invoice_permission."id"
FROM "Role" AS role
JOIN "Permission" AS invoice_permission ON invoice_permission."tenantId" = role."tenantId" AND invoice_permission."code" = 'MANAGE_INVOICES'
WHERE role."name" = 'Administrator' AND EXISTS (
    SELECT 1 FROM "RolePermission" AS grant_row
    JOIN "Permission" AS permission ON permission."tenantId" = grant_row."tenantId" AND permission."id" = grant_row."permissionId"
    WHERE grant_row."tenantId" = role."tenantId" AND grant_row."roleId" = role."id" AND permission."code" = 'MANAGE_RBAC'
)
ON CONFLICT DO NOTHING;
