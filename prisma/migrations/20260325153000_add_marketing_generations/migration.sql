-- CreateEnum
CREATE TYPE "MarketingGenerationTool" AS ENUM ('FACEBOOK_ADS');

-- CreateEnum
CREATE TYPE "MarketingGenerationProvider" AS ENUM ('OPENAI', 'GEMINI');

-- CreateEnum
CREATE TYPE "MarketingGenerationStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "MarketingGeneration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tool" "MarketingGenerationTool" NOT NULL,
    "provider" "MarketingGenerationProvider" NOT NULL,
    "status" "MarketingGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "model" TEXT,
    "imageModel" TEXT,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "imageUrl" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingGeneration_workspaceId_tool_createdAt_idx" ON "MarketingGeneration"("workspaceId", "tool", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingGeneration_workspaceId_status_createdAt_idx" ON "MarketingGeneration"("workspaceId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "MarketingGeneration" ADD CONSTRAINT "MarketingGeneration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
