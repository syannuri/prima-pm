-- CreateTable
CREATE TABLE "CustomFieldDef" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entity" TEXT NOT NULL DEFAULT 'project',
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldValue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "defId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "value" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDef_tenantId_entity_key_key" ON "CustomFieldDef"("tenantId", "entity", "key");

-- CreateIndex
CREATE INDEX "CustomFieldDef_tenantId_entity_idx" ON "CustomFieldDef"("tenantId", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldValue_defId_entityId_key" ON "CustomFieldValue"("defId", "entityId");

-- CreateIndex
CREATE INDEX "CustomFieldValue_tenantId_entityId_idx" ON "CustomFieldValue"("tenantId", "entityId");

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_defId_fkey" FOREIGN KEY ("defId") REFERENCES "CustomFieldDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;
