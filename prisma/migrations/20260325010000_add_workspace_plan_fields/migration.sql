-- CreateEnum
CREATE TYPE "WorkspacePlanTier" AS ENUM ('GRATIS', 'BASICO', 'AVANZADO');

-- AlterTable
ALTER TABLE "Workspace"
ADD COLUMN "planTier" "WorkspacePlanTier",
ADD COLUMN "planStartedAt" TIMESTAMP(3),
ADD COLUMN "planExpiresAt" TIMESTAMP(3);
