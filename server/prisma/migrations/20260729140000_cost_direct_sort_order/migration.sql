-- Manual display order for direct cost lines (drag-to-reorder within a category family).
ALTER TABLE "CostItemDirect" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Seed a stable initial order from current creation order, per project.
WITH ordered AS (
  SELECT id, (ROW_NUMBER() OVER (PARTITION BY "projectId" ORDER BY "createdAt" ASC))::int AS rn
  FROM "CostItemDirect"
)
UPDATE "CostItemDirect" c SET "sortOrder" = o.rn FROM ordered o WHERE o.id = c.id;
