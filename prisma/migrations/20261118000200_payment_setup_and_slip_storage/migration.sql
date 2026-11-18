ALTER TABLE "PaymentSettings"
  ADD COLUMN "payhereConfigured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "payhereEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "payhereSandbox" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "payhereMerchantId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "payhereMerchantSecretEncrypted" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "payhereNotifyUrl" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "payhereReturnOrigin" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "contactPhone" TEXT NOT NULL DEFAULT '';

ALTER TABLE "BankTransferSlip"
  ADD COLUMN "storagePath" TEXT,
  ALTER COLUMN "attachment" DROP NOT NULL;

ALTER TABLE "BankTransferSlip" DROP CONSTRAINT "BankTransferSlip_size_limit";
ALTER TABLE "BankTransferSlip" ADD CONSTRAINT "BankTransferSlip_size_limit" CHECK (
  "fileSize" > 0 AND "fileSize" <= 5242880
  AND (("attachment" IS NOT NULL AND octet_length("attachment") = "fileSize")
    OR ("attachment" IS NULL AND "storagePath" IS NOT NULL))
);
