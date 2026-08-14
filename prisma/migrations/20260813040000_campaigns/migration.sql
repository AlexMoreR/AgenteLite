-- Campañas: elegir un grupo de leads hoy y mandarles un mensaje, una vez.
--
-- Aparte de FollowRule a proposito: la regla de seguimiento corre sola para siempre sobre el que
-- cumpla la condicion; la campaña se arma, se dispara y se termina. Mezclarlas hacia que nadie
-- supiera en cual entrar.
--
-- batchSize e intervalMinutes NO son opciones avanzadas: WhatsApp bloquea numeros por mandar
-- muchos mensajes parecidos a gente que hace rato no escribe, y el numero que se cae es el que da
-- de comer. Por eso el freno es parte del modelo y no algo que se pueda omitir.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampaignStatus') THEN
    CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'DONE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampaignRecipientStatus') THEN
    CREATE TYPE "CampaignRecipientStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Campaign" (
  "id"              TEXT NOT NULL,
  "workspaceId"     TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "channelId"       TEXT,
  "crmStage"        TEXT,
  "messageType"     "FollowMessageType" NOT NULL DEFAULT 'TEXT',
  "content"         TEXT,
  "mediaUrl"        TEXT,
  "batchSize"       INTEGER NOT NULL DEFAULT 20,
  "intervalMinutes" INTEGER NOT NULL DEFAULT 30,
  "status"          "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "totalRecipients" INTEGER NOT NULL DEFAULT 0,
  "sentCount"       INTEGER NOT NULL DEFAULT 0,
  "lastBatchAt"     TIMESTAMP(3),
  "startedAt"       TIMESTAMP(3),
  "finishedAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CampaignRecipient" (
  "id"         TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "contactId"  TEXT NOT NULL,
  "status"     "CampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
  "followId"   TEXT,
  "sentAt"     TIMESTAMP(3),
  "error"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Campaign_workspaceId_status_idx" ON "Campaign" ("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "Campaign_status_lastBatchAt_idx" ON "Campaign" ("status", "lastBatchAt");
CREATE UNIQUE INDEX IF NOT EXISTS "CampaignRecipient_campaignId_contactId_key" ON "CampaignRecipient" ("campaignId", "contactId");
CREATE INDEX IF NOT EXISTS "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient" ("campaignId", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Campaign_workspaceId_fkey') THEN
    ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Campaign_channelId_fkey') THEN
    ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_channelId_fkey"
      FOREIGN KEY ("channelId") REFERENCES "WhatsAppChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignRecipient_campaignId_fkey') THEN
    ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignRecipient_contactId_fkey') THEN
    ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
