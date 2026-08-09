-- No-code automation rules (event → notify). Tenant-scoped; additive.

CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "conditionField" TEXT,
    "conditionEquals" TEXT,
    "actionType" TEXT NOT NULL DEFAULT 'NOTIFY',
    "notifyPm" BOOLEAN NOT NULL DEFAULT false,
    "notifyRole" "Role",
    "messageTemplate" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AutomationRule_tenantId_idx" ON "AutomationRule"("tenantId");

ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
