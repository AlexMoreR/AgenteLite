-- AlterTable
ALTER TABLE "AgentKnowledgeProduct" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "businessConfig" JSONB;
