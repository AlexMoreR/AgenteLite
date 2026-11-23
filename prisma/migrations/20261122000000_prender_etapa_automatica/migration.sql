-- Etapa automatica del CRM: se PRENDE (pedido de Alex, 22-nov-2026). Solo cambia interruptores en "AppSetting".
--
-- Estaba apagada desde el 12-13 de noviembre (crm:etapa-automatica:<negocio> = off, puesto a mano). Al prenderla
-- se prenden solos tres procesos que Alex decidio dejar APAGADOS, asi que primero se apagan ellos:
--   crm:etapa-automatica:descarte:<negocio>   = off  (Descartado automatico por frase)
--   crm:etapa-automatica:ganado:<negocio>     = off  (Ganado desde las ventas de Gestion)
--   crm:etapa-automatica:barrido-ia:<negocio> = off  (la IA del barrido que lee los chats sin etapa)
-- y despues el interruptor general pasa de off a on. Un negocio que no lo tenia en off no cambia.
--
-- No crea tablas ni columnas, no borra nada. Se deshace poniendo crm:etapa-automatica:<negocio> = off otra vez.
-- Correrla dos veces da lo mismo. Probada con PGlite: npm run test:prender-etapa-automatica-migracion
BEGIN;

INSERT INTO "AppSetting" ("key", "value", "createdAt", "updatedAt")
SELECT 'crm:etapa-automatica:' || sub.nombre || ':' || w."id", 'off', now(), now()
FROM "Workspace" w
CROSS JOIN (VALUES ('descarte'), ('ganado'), ('barrido-ia')) AS sub(nombre)
WHERE EXISTS (
  SELECT 1 FROM "AppSetting" a WHERE a."key" = 'crm:etapa-automatica:' || w."id" AND lower(trim(a."value")) = 'off'
)
ON CONFLICT ("key") DO UPDATE SET "value" = 'off', "updatedAt" = now();

UPDATE "AppSetting"
SET "value" = 'on', "updatedAt" = now()
WHERE "key" IN (SELECT 'crm:etapa-automatica:' || w."id" FROM "Workspace" w)
  AND lower(trim("value")) = 'off';

COMMIT;
