-- Index the guest-sandbox scoping column: personalOwnerId is filtered by nearly every list /
-- aggregate query (portfolio, notifications, resource capacity, EVM trend, admin audit).
CREATE INDEX "Project_personalOwnerId_idx" ON "Project"("personalOwnerId");
