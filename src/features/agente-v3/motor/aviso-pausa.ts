import { Prisma } from "@prisma/client";

/**
 * El acuse "En un momento una de nuestras asesoras te contacta 🙌" de un chat pausado: UNA vez por pausa.
 *
 * Salio DOBLE (13-10-2026, 10:36, Ventas 1): la clienta mando "como estas?" y "Hola buen dia" con dos
 * segundos de diferencia, cada mensaje entro por su propio webhook, los dos leyeron
 * `avisoDePausaEnviado: false` antes de que el primero alcanzara a guardarlo, y los dos enviaron.
 *
 * Leer-y-despues-guardar no sirve con llegadas simultaneas. Ahora la marca se RECLAMA antes de enviar,
 * en una sola sentencia de Postgres sobre la fila de estado del V3 (AppSetting): solo una de las
 * llegadas consigue pasarla de false a true, y solo esa envia. Si el envio falla, la marca se suelta
 * para que el proximo mensaje de la clienta vuelva a intentarlo.
 *
 * Este archivo no importa `@/lib/prisma`: el SQL y la secuencia se prueban sin base real
 * (scripts/check-aviso-pausa.mjs).
 */

/** Mensajes escritos por una persona del equipo: desde el CRM (`manual`) o desde el celular (`instance`). */
export const FUENTES_DE_ASESORA = ["manual", "instance"] as const;

/**
 * Reclama la marca de aviso enviado. Devuelve una fila si ESTA llamada la gano; ninguna si ya estaba
 * reclamada. `insertado` dice si la fila de estado la creo este reclamo (el chat no tenia estado).
 *
 * En Postgres, `INSERT ... ON CONFLICT DO UPDATE ... WHERE` bloquea la fila y reevalua la condicion
 * sobre la version ya confirmada: dos reclamos simultaneos nunca ganan los dos.
 */
export function sqlReclamarAvisoDePausa(clave: string, valorSiNoHayFila: string): Prisma.Sql {
  return Prisma.sql`
    INSERT INTO "AppSetting" ("key", "value", "createdAt", "updatedAt")
    VALUES (${clave}, ${valorSiNoHayFila}, now(), now())
    ON CONFLICT ("key") DO UPDATE
      SET "value" = jsonb_set("AppSetting"."value"::jsonb, '{avisoDePausaEnviado}', 'true'::jsonb)::text,
          "updatedAt" = now()
      WHERE COALESCE(("AppSetting"."value"::jsonb ->> 'avisoDePausaEnviado') = 'true', false) = false
    RETURNING (xmax = 0) AS "insertado"
  `;
}

/** Suelta la marca tras un envio fallido. Si la fila la creo el reclamo, se quita tal cual estaba. */
export function sqlLiberarAvisoDePausa(clave: string, reclamo: { insertado: boolean; valor: string }): Prisma.Sql {
  if (reclamo.insertado) {
    return Prisma.sql`DELETE FROM "AppSetting" WHERE "key" = ${clave} AND "value" = ${reclamo.valor}`;
  }
  return Prisma.sql`
    UPDATE "AppSetting"
    SET "value" = jsonb_set("value"::jsonb, '{avisoDePausaEnviado}', 'false'::jsonb)::text,
        "updatedAt" = now()
    WHERE "key" = ${clave}
  `;
}

export type DependenciasAvisoDePausa = {
  /** ¿Una persona del equipo escribio en este chat en las ultimas horas? (CRM o celular) */
  personaAtendiendo: () => Promise<boolean>;
  /** ¿Salio algo nuestro hace muy poco? */
  respuestaReciente: () => Promise<boolean>;
  /** Lectura barata previa: si la marca ya esta puesta, ni se intenta el reclamo. */
  avisoYaEnviado: () => Promise<boolean>;
  /** Reclamo atomico; null si otra llegada ya lo tiene. */
  reclamar: () => Promise<{ insertado: boolean } | null>;
  liberar: (reclamo: { insertado: boolean }) => Promise<void>;
  /** true si el mensaje salio. */
  enviar: () => Promise<boolean>;
};

export type ResultadoAvisoDePausa =
  | "persona_atendiendo"
  | "respuesta_reciente"
  | "ya_enviado"
  | "enviado"
  | "fallo_envio";

export async function enviarAvisoDePausaUnaVez(deps: DependenciasAvisoDePausa): Promise<ResultadoAvisoDePausa> {
  if (await deps.personaAtendiendo()) return "persona_atendiendo";
  if (await deps.respuestaReciente()) return "respuesta_reciente";
  if (await deps.avisoYaEnviado()) return "ya_enviado";

  const reclamo = await deps.reclamar();
  if (!reclamo) return "ya_enviado";

  let salio = false;
  try {
    salio = await deps.enviar();
  } finally {
    if (!salio) {
      await deps.liberar(reclamo);
    }
  }
  return salio ? "enviado" : "fallo_envio";
}
