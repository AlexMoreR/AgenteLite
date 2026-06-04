ALTER TABLE "WorkspaceMember"
ADD COLUMN "moduleAccess" JSONB,
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "invitedAt" TIMESTAMP(3),
ADD COLUMN "acceptedAt" TIMESTAMP(3),
ADD COLUMN "deactivatedAt" TIMESTAMP(3);

CREATE INDEX "WorkspaceMember_workspaceId_isActive_idx" ON "WorkspaceMember"("workspaceId", "isActive");
