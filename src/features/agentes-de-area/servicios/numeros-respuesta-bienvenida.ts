import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import {
  CANAL_ADMIN_ID,
  DIAS_DE_LA_SERIE_DE_BIENVENIDA,
  serieDeRespuestaBienvenida,
  type LeadDeBienvenida,
  type RespuestaBienvenidaDelDia,
} from "../dominio/reglas";
import { rangoDeDias } from "./numeros-de-marketing";

/**
 * LA TASA DE RESPUESTA A LA BIENVENIDA (solo lectura): de los leads que entraron cada día (EmbudoLead por su hora
 * de entrada, hora de Colombia), cuántos mandaron al menos un mensaje más después del primero, y si fue por la bienvenida o por un seguimiento (EmbudoEvento). Una sola consulta
 * agrupa los 14 días; no escribe nada ni manda mensajes. Un mensaje borrado no cuenta y la línea Admin no entra.
 */

const MAX_LEADS = 5000;

type FilaDeLead = {
  dia: string;
  canalId: string | null;
  proposito: string | null;
  linea: string | null;
  anuncioId: string | null;
  anuncioTitulo: string | null;
  mensajes: bigint | number;
  minutos: number | null;
  /** Seguimientos del chat: `minutos` (datos.minutos, texto o null) y `despues` (minutos desde el primer mensaje del cliente). */
  seguimientos: Array<{ minutos: string | number | null; despues: number | string | null }> | null;
};

export type NumerosDeRespuestaBienvenida = {
  fecha: string;
  dias: number;
  /** El día pedido (el último de la serie). */
  delDia: RespuestaBienvenidaDelDia;
  /** Una medida por día, del más viejo al más nuevo. */
  serie: RespuestaBienvenidaDelDia[];
  /** Conversaciones nuevas de la línea de ventas sin registro en EmbudoLead: no entran a la cuenta. */
  conversacionesSinRegistro: number;
  advertencias: string[];
};

export async function numerosDeRespuestaBienvenida(workspaceId: string, fecha: string, dias = DIAS_DE_LA_SERIE_DE_BIENVENIDA): Promise<NumerosDeRespuestaBienvenida> {
  const { desde, hasta } = rangoDeDias(fecha, dias);

  const filas = await prisma.$queryRaw<FilaDeLead[]>(Prisma.sql`
    SELECT to_char(e."entradaEn" - interval '5 hours', 'YYYY-MM-DD') AS "dia",
           e."channelId" AS "canalId", w."purpose"::text AS "proposito", w."name" AS "linea",
           e."anuncioId" AS "anuncioId", e."anuncioTitulo" AS "anuncioTitulo",
           coalesce(m."mensajes", 0) AS "mensajes",
           CASE WHEN m."segundo" IS NULL THEN NULL
                ELSE EXTRACT(EPOCH FROM (m."segundo" - m."primero")) / 60.0 END AS "minutos",
           s."lista" AS "seguimientos"
      FROM "EmbudoLead" e
      LEFT JOIN "WhatsAppChannel" w ON w."id" = e."channelId"
      LEFT JOIN LATERAL (
        SELECT count(*) AS "mensajes", min(x."createdAt") AS "primero",
               (array_agg(x."createdAt" ORDER BY x."createdAt"))[2] AS "segundo"
          FROM "Message" x
         WHERE x."conversationId" = e."conversationId" AND x."direction" = 'INBOUND'
           AND x."deletedAt" IS NULL) m ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
                 'minutos', ev."datos"->>'minutos',
                 'despues', EXTRACT(EPOCH FROM (ev."createdAt" - m."primero")) / 60.0) ORDER BY ev."createdAt") AS "lista"
          FROM "EmbudoEvento" ev
         WHERE ev."workspaceId" = e."workspaceId" AND ev."conversationId" = e."conversationId"
           AND ev."tipo" = 'SEGUIMIENTO_ENVIADO') s ON true
     WHERE e."workspaceId" = ${workspaceId}
       AND e."entradaEn" >= ${desde} AND e."entradaEn" < ${hasta}
       AND (w."purpose" IS NULL OR w."purpose" <> 'ADMIN')
       AND (e."channelId" IS NULL OR e."channelId" <> ${CANAL_ADMIN_ID})
     LIMIT ${MAX_LEADS}`);

  const leads: LeadDeBienvenida[] = filas.map((fila) => ({
    dia: fila.dia,
    canalId: fila.canalId,
    proposito: fila.proposito,
    linea: fila.linea ?? "Sin línea",
    anuncioId: fila.anuncioId,
    anuncioTitulo: fila.anuncioTitulo,
    mensajes: Number(fila.mensajes ?? 0),
    minutosAlSegundo: fila.minutos === null || fila.minutos === undefined ? null : Number(fila.minutos),
    seguimientos: (fila.seguimientos ?? []).map((s) => {
      const declarados = s.minutos === null || s.minutos === undefined || s.minutos === "" ? NaN : Number(s.minutos);
      const despues = s.despues === null || s.despues === undefined ? NaN : Number(s.despues);
      return {
        minutosDesdeElPrimero: Number.isFinite(despues) ? despues : null,
        minutosDeclarados: Number.isFinite(declarados) ? declarados : null,
      };
    }),
  }));
  const serie = serieDeRespuestaBienvenida(leads, fecha, dias);

  // Conversaciones nuevas que nunca quedaron en EmbudoLead: no se pueden contar y se avisa.
  const sinRegistro = await prisma.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
    SELECT count(*) AS "total"
      FROM "Conversation" c
      LEFT JOIN "WhatsAppChannel" w ON w."id" = c."channelId"
     WHERE c."workspaceId" = ${workspaceId}
       AND c."createdAt" >= ${desde} AND c."createdAt" < ${hasta}
       AND (w."purpose" IS NULL OR w."purpose" <> 'ADMIN')
       AND (c."channelId" IS NULL OR c."channelId" <> ${CANAL_ADMIN_ID})
       AND NOT EXISTS (SELECT 1 FROM "EmbudoLead" e WHERE e."conversationId" = c."id")`);
  const conversacionesSinRegistro = Number(sinRegistro[0]?.total ?? 0);

  const advertencias = [
    "Se cuentan todos los leads que entraron ese día (EmbudoLead), sin importar a qué etapa pasaron; la línea Admin no entra. Un lead 'respondió' si mandó al menos un mensaje más después del primero (el primero suele ser el texto automático del anuncio).",
    "Respondieron la bienvenida = escribieron su segundo mensaje antes de que les saliera cualquier seguimiento automático. Recuperados = no respondieron antes del primer seguimiento y escribieron después; se cuentan por el ÚLTIMO seguimiento que ya les había salido (min15 = 15 min, hora1 = 1 hora, dia1 = 1 día, otro = uno que no encaja). Nunca respondieron = jamás mandaron un segundo mensaje. Los tres grupos suman los leads.",
    "Los seguimientos del V3 traen sus minutos (15, 60, 1440). Los del motor viejo no: se reconocen por los minutos entre el primer mensaje del cliente y el envío (hasta 30 min = 15 min, hasta 3 h = 1 hora, más = 1 día); es una suposición razonable, no un dato exacto.",
    "Los chats sin evento SEGUIMIENTO_ENVIADO (anteriores al registro o con el embudo apagado) salen como 'respondieron la bienvenida' si escribieron y 'nunca' si no: no se pueden contar como recuperados.",
    "'En menos de 2 horas' cuenta desde el primer mensaje del cliente hasta el segundo (justo 2 horas ya no cuenta). Un día sin leads sale null = 'sin dato', no 0 %.",
  ];
  if (conversacionesSinRegistro > 0) {
    advertencias.push(`${conversacionesSinRegistro} conversaciones nuevas de los últimos ${dias} días no tienen registro en EmbudoLead y no entran a la cuenta.`);
  }
  if (filas.length >= MAX_LEADS) advertencias.push(`Se leyeron solo los primeros ${MAX_LEADS} leads: la cuenta puede estar incompleta.`);

  return { fecha, dias, delDia: serie[serie.length - 1], serie, conversacionesSinRegistro, advertencias };
}
