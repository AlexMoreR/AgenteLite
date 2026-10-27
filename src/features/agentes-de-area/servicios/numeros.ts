import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import {
  contarEtapasPorAsesora,
  medirSugeridos,
  type CambioDeEtapaDelDia,
  tasaDeCierre,
  type ActividadDelSugerido,
  type MedidaDeLosSugeridos,
  type Area,
  type Sugerido,
} from "../dominio/reglas";
import { leerResumenDelDia } from "./resumenes";

/**
 * LOS NÚMEROS DE UN DÍA POR ASESORA (solo lectura): así el agente no abre los chats uno por uno.
 * El día es el de Colombia (UTC-5, sin horario de verano). Todo se filtra por el negocio de la clave.
 */

const HORA = 3_600_000;

/** [desde, hasta) en UTC del día "AAAA-MM-DD" de Colombia. */
export function rangoDelDia(fecha: string): { desde: Date; hasta: Date } {
  const desde = new Date(new Date(`${fecha}T00:00:00Z`).getTime() + 5 * HORA);
  return { desde, hasta: new Date(desde.getTime() + 24 * HORA) };
}

export type NumerosDeAsesora = {
  asesoraId: string | null;
  asesora: string;
  chatsAtendidos: number;
  cotizaciones: number;
  ventas: number;
  cierrePorCiento: number | null;
  /** Mediana, en minutos, entre un mensaje del cliente y la primera respuesta humana. */
  tiempoDeRespuestaMin: number | null;
};

type FilaAtendidos = { asesoraId: string | null; asesora: string | null; atendidos: bigint | number };
type FilaRespuesta = { asesoraId: string | null; mediana: number | null };

const numero = (valor: bigint | number | null | undefined) => Number(valor ?? 0);

export async function numerosDelDia(workspaceId: string, fecha: string): Promise<NumerosDeAsesora[]> {
  const { desde, hasta } = rangoDelDia(fecha);

  const atendidos = await prisma.$queryRaw<FilaAtendidos[]>(Prisma.sql`
    SELECT c."assignedToUserId" AS "asesoraId", u."name" AS "asesora", count(DISTINCT c."id") AS "atendidos"
      FROM "Message" m
      JOIN "Conversation" c ON c."id" = m."conversationId"
      LEFT JOIN "User" u ON u."id" = c."assignedToUserId"
     WHERE m."workspaceId" = ${workspaceId}
       AND m."direction" = 'OUTBOUND'
       AND m."createdAt" >= ${desde} AND m."createdAt" < ${hasta}
       AND m."rawPayload"->>'source' IN ('manual', 'instance')
     GROUP BY c."assignedToUserId", u."name"`);

  // Un cambio por fila, con la línea del chat: la regla (sin Admin, un teléfono una venta) vive en `reglas.ts`.
  const cambios = await prisma.$queryRaw<CambioDeEtapaDelDia[]>(Prisma.sql`
    SELECT c."assignedToUserId" AS "asesoraId", h."conversationId" AS "conversationId", c."contactId" AS "contactId",
           h."etapaNueva"::text AS "etapaNueva", c."channelId" AS "canalId", w."purpose"::text AS "proposito"
      FROM "HistorialEtapa" h
      JOIN "Conversation" c ON c."id" = h."conversationId"
      LEFT JOIN "WhatsAppChannel" w ON w."id" = c."channelId"
     WHERE h."workspaceId" = ${workspaceId}
       AND h."creadoEn" >= ${desde} AND h."creadoEn" < ${hasta}
       AND h."etapaNueva"::text IN ('PROPUESTA', 'NEGOCIACION', 'GANADO')
     ORDER BY h."creadoEn" ASC`);
  const etapas = [...contarEtapasPorAsesora(cambios).values()];

  const respuestas = await prisma.$queryRaw<FilaRespuesta[]>(Prisma.sql`
    SELECT x."asesoraId", percentile_cont(0.5) WITHIN GROUP (ORDER BY x."minutos") AS "mediana"
      FROM (
        SELECT c."assignedToUserId" AS "asesoraId",
               EXTRACT(EPOCH FROM (r."createdAt" - m."createdAt")) / 60.0 AS "minutos"
          FROM "Message" m
          JOIN "Conversation" c ON c."id" = m."conversationId"
          JOIN LATERAL (
            SELECT o."createdAt" FROM "Message" o
             WHERE o."conversationId" = m."conversationId" AND o."direction" = 'OUTBOUND'
               AND o."createdAt" > m."createdAt" AND o."rawPayload"->>'source' IN ('manual', 'instance')
             ORDER BY o."createdAt" ASC LIMIT 1) r ON true
         WHERE m."workspaceId" = ${workspaceId} AND m."direction" = 'INBOUND'
           AND m."createdAt" >= ${desde} AND m."createdAt" < ${hasta}
           AND r."createdAt" < m."createdAt" + interval '12 hours') x
     GROUP BY x."asesoraId"`);

  const porAsesora = new Map<string, NumerosDeAsesora>();
  const clave = (id: string | null) => id ?? "sin-asesora";
  const obtener = (id: string | null, nombre: string | null) => {
    const existente = porAsesora.get(clave(id));
    if (existente) {
      if (nombre && existente.asesora === "sin asesora") existente.asesora = nombre;
      return existente;
    }
    const nueva: NumerosDeAsesora = {
      asesoraId: id,
      asesora: nombre ?? "sin asesora",
      chatsAtendidos: 0,
      cotizaciones: 0,
      ventas: 0,
      cierrePorCiento: null,
      tiempoDeRespuestaMin: null,
    };
    porAsesora.set(clave(id), nueva);
    return nueva;
  };
  for (const fila of atendidos) obtener(fila.asesoraId, fila.asesora).chatsAtendidos = numero(fila.atendidos);
  for (const fila of etapas) {
    const dato = obtener(fila.asesoraId, null);
    dato.cotizaciones = fila.cotizaciones;
    dato.ventas = fila.ventas;
  }
  for (const fila of respuestas) {
    obtener(fila.asesoraId, null).tiempoDeRespuestaMin = fila.mediana === null ? null : Math.round(Number(fila.mediana));
  }
  // Los nombres que faltan (asesoras que solo tienen etapas o respuestas).
  const sinNombre = [...porAsesora.values()].filter((dato) => dato.asesoraId && dato.asesora === "sin asesora");
  if (sinNombre.length) {
    const usuarios = await prisma.user
      .findMany({ where: { id: { in: sinNombre.map((dato) => dato.asesoraId as string) } }, select: { id: true, name: true } })
      .catch(() => []);
    for (const usuario of usuarios) {
      const dato = porAsesora.get(clave(usuario.id));
      if (dato && usuario.name) dato.asesora = usuario.name;
    }
  }
  for (const dato of porAsesora.values()) dato.cierrePorCiento = tasaDeCierre(dato.ventas, dato.chatsAtendidos);
  return [...porAsesora.values()].sort((a, b) => b.chatsAtendidos - a.chatsAtendidos);
}

export type AvisosDelSupervisor = { critico: number; importante: number; observacion: number } | null;

/** Cuántos avisos nuevos detectó el Supervisor ese día (por gravedad). Null si la tabla no responde. */
export async function avisosDelSupervisor(workspaceId: string, fecha: string): Promise<AvisosDelSupervisor> {
  const { desde, hasta } = rangoDelDia(fecha);
  try {
    const filas = await prisma.supervisorAlerta.groupBy({
      by: ["severidad"],
      where: { workspaceId, primeraVezEn: { gte: desde, lt: hasta } },
      _count: { _all: true },
    });
    const cuenta = (severidad: string) => filas.find((fila) => fila.severidad === severidad)?._count._all ?? 0;
    return { critico: cuenta("CRITICO"), importante: cuenta("IMPORTANTE"), observacion: cuenta("OBSERVACION") };
  } catch {
    return null;
  }
}

export type MedicionDeSugeridos = {
  /** Día en que se sugirieron. */
  fechaDeLosSugeridos: string;
  total: MedidaDeLosSugeridos;
  porAsesora: Array<{ asesora: string } & MedidaDeLosSugeridos>;
  sinConversacion: number;
} | null;

type FilaActividad = { conversationId: string; leEscribieron: boolean; respondio: boolean; compro: boolean };

/**
 * Mide los sugeridos que el agente guardó en el resumen de `fechaDeLosSugeridos`: a cuáles les
 * escribió el equipo, cuáles respondieron y cuáles quedaron GANADO. Null si ese día no hay resumen.
 */
export async function medirLosSugeridosDe(workspaceId: string, area: Area, fechaDeLosSugeridos: string): Promise<MedicionDeSugeridos> {
  const resumen = await leerResumenDelDia(workspaceId, area, fechaDeLosSugeridos);
  const sugeridos = Array.isArray(resumen?.sugeridos) ? (resumen.sugeridos as Sugerido[]) : [];
  if (!resumen || !sugeridos.length) return null;
  // La hora de corte es el momento en que el agente guardó el resumen de ese día.
  const corte = resumen.actualizadoEn;
  const ids = [...new Set(sugeridos.map((s) => s.conversacionId).filter((id): id is string => Boolean(id)))];
  const filas = ids.length
    ? await prisma.$queryRaw<FilaActividad[]>(Prisma.sql`
        SELECT c."id" AS "conversationId",
               EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = c."id" AND m."direction" = 'OUTBOUND'
                         AND m."createdAt" > ${corte} AND m."rawPayload"->>'source' IN ('manual', 'instance')) AS "leEscribieron",
               EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = c."id" AND m."direction" = 'INBOUND'
                         AND m."createdAt" > ${corte}) AS "respondio",
               (ct."crmStage"::text = 'GANADO') AS "compro"
          FROM "Conversation" c
          JOIN "Contact" ct ON ct."id" = c."contactId"
         WHERE c."workspaceId" = ${workspaceId} AND c."id" IN (${Prisma.join(ids)})`)
    : [];
  const actividadPorChat = new Map(filas.map((fila) => [fila.conversationId, fila]));
  const porAsesora = new Map<string, ActividadDelSugerido[]>();
  const todas: ActividadDelSugerido[] = [];
  let sinConversacion = 0;
  for (const sugerido of sugeridos) {
    const fila = sugerido.conversacionId ? actividadPorChat.get(sugerido.conversacionId) : undefined;
    if (!fila) {
      sinConversacion += 1;
      continue;
    }
    const actividad = { leEscribieron: fila.leEscribieron, respondio: fila.respondio, compro: fila.compro };
    todas.push(actividad);
    porAsesora.set(sugerido.asesora, [...(porAsesora.get(sugerido.asesora) ?? []), actividad]);
  }
  return {
    fechaDeLosSugeridos,
    total: medirSugeridos(todas),
    porAsesora: [...porAsesora.entries()].map(([asesora, lista]) => ({ asesora, ...medirSugeridos(lista) })),
    sinConversacion,
  };
}
