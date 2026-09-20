import { prisma } from "@/lib/prisma";

/**
 * Retencion de WebhookEventLog.
 *
 * La tabla nacio sin nadie que la limpiara y llego a 49 GB (el 88% de la base entera). Aunque ya
 * no se guarde la media —ver stripMediaFromWebhookPayload en el webhook de Evolution—, 380 mil
 * filas en seis meses siguen siendo un archivo que nadie mira: sirve para depurar lo de ayer, no
 * lo del trimestre pasado.
 */
const RETENTION_DAYS = 7;

/**
 * Los HISTORYSYNC viven mas: son los que lee readEvolutionGoHistoryChats para "Cargar historial"
 * en canales evogo, con un lookback de 60 dias. Se guardan 90 por margen; son pocos (176 en toda
 * la historia de la tabla) y chicos, asi que no pesan.
 */
const HISTORY_SYNC_RETENTION_DAYS = 90;

/** Tope por corrida: borrar de a poco no traba la tabla mientras entran webhooks. */
const MAX_DELETES_PER_RUN = 5000;

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Borra los logs de webhook vencidos. Best-effort: devuelve cuantos borro.
 *
 * Ojo: un DELETE no le devuelve el espacio al disco (para eso hace falta VACUUM FULL), pero si
 * deja el espacio libre para que la propia tabla lo reutilice. Eso es lo que corta el crecimiento
 * sin fin, que es el problema real.
 */
export async function purgeOldWebhookEventLogs(): Promise<{ deleted: number }> {
  const deleted = await prisma.$executeRaw`
    DELETE FROM "WebhookEventLog"
    WHERE "id" IN (
      SELECT "id" FROM "WebhookEventLog"
      WHERE (
        ("event" = 'HISTORYSYNC' AND "createdAt" < ${daysAgo(HISTORY_SYNC_RETENTION_DAYS)})
        OR ("event" IS DISTINCT FROM 'HISTORYSYNC' AND "createdAt" < ${daysAgo(RETENTION_DAYS)})
      )
      LIMIT ${MAX_DELETES_PER_RUN}
    )
  `;

  return { deleted };
}
