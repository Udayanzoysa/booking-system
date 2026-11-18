ALTER TABLE "User" ADD COLUMN "googleSubject" TEXT;
CREATE UNIQUE INDEX "User_tenantId_googleSubject_key" ON "User"("tenantId", "googleSubject");
