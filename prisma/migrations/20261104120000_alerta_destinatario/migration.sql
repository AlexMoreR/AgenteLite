-- Alertas personales: cada aviso por WhatsApp al equipo queda también como alerta de esa persona.
-- Solo aditiva (columna nullable + índice; las alertas de siempre quedan en null) y se puede correr dos veces.
BEGIN;
ALTER TABLE "AlertaInterna" ADD COLUMN IF NOT EXISTS "destinatarioId" TEXT;
CREATE INDEX IF NOT EXISTS "AlertaInterna_workspaceId_destinatarioId_estado_idx" ON "AlertaInterna" ("workspaceId", "destinatarioId", "estado");
COMMIT;
