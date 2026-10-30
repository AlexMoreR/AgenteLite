import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { leerMapaDeLineas } from "@/lib/origen-de-venta-crm";

import { fechaValida } from "../../agentes-de-area/dominio/reglas";
import { rangoDelDia } from "../../agentes-de-area/servicios/numeros";
import { agruparLeads, leadsNuevosDeLasFilas, type FilaDeLeadNuevo, type LeadsNuevosAgrupados } from "../dominio/reglas";

/**
 * LOS LEADS NUEVOS DE UN DÍA (solo lectura): clientes cuyo primer mensaje de la vida cae en ese día de Colombia,
 * por cualquier línea. Lee Message, Conversation, Contact.metadata, EmbudoLead, WhatsAppChannel y ContactTag; no
 * escribe nada ni manda mensajes. Las reglas (origen, línea, asesora) están en ../dominio/reglas.ts.
 */

const MAX_CLIENTES = 5000;
const SLUG_MARKETPLACE = "marketplace";

type FilaCruda = {
  telefono: string;
  metadataContacto: unknown;
  canalId: string | null;
  linea: string | null;
  proposito: string | null;
  metadataLinea: unknown;
  asesoraId: string | null;
  asesora: string | null;
  primero: Date;
  texto: string | null;
  anuncioEnEmbudo: boolean;
  etiquetaMarketplace: boolean;
};

export type LeadsNuevosDelDia = LeadsNuevosAgrupados & { advertencias: string[] };

export async function leadsNuevosDelDia(
  workspaceId: string,
  fecha: string,
  opciones: { asesoraId?: string | null } = {},
): Promise<LeadsNuevosDelDia> {
  if (!fechaValida(fecha)) throw new Error("La fecha tiene que ir como AAAA-MM-DD.");
  const { desde, hasta } = rangoDelDia(fecha);

  // 1) Clientes que escribieron ese día y nunca antes (por ninguna línea).
  const candidatos = await prisma.$queryRaw<Array<{ contactId: string }>>(Prisma.sql`
    SELECT DISTINCT c."contactId" AS "contactId"
      FROM "Message" m
      JOIN "Conversation" c ON c."id" = m."conversationId"
     WHERE m."workspaceId" = ${workspaceId}
       AND m."direction" = 'INBOUND' AND m."deletedAt" IS NULL AND m."isStatusBroadcast" = false
       AND m."createdAt" >= ${desde} AND m."createdAt" < ${hasta}
       AND NOT EXISTS (
         SELECT 1 FROM "Message" x
           JOIN "Conversation" cx ON cx."id" = x."conversationId"
          WHERE cx."contactId" = c."contactId" AND x."workspaceId" = ${workspaceId}
            AND x."direction" = 'INBOUND' AND x."deletedAt" IS NULL AND x."isStatusBroadcast" = false
            AND x."createdAt" < ${desde})
     LIMIT ${MAX_CLIENTES}`);

  const advertencias: string[] = [
    "Un lead nuevo es un cliente cuyo primer mensaje de la vida cae en el día (hora de Colombia), por cualquier línea. Si escribe por dos líneas cuenta una vez, en la que escribió primero.",
    "Los pases de NETMAGI sin texto de Marketplace que no entren por Ventas 2 salen como Directo.",
  ];
  if (candidatos.length >= MAX_CLIENTES) {
    advertencias.push(`Se leyeron solo los primeros ${MAX_CLIENTES} clientes del día: la cuenta puede estar incompleta.`);
  }
  if (!candidatos.length) return { ...agruparLeads([], fecha), advertencias };

  // 2) Todos los chats de esos clientes (así se ve en qué línea escribieron primero y quién los atiende).
  const ids = candidatos.map((c) => c.contactId);
  const crudas = await prisma.$queryRaw<FilaCruda[]>(Prisma.sql`
    SELECT ct."phoneNumber" AS "telefono", ct."metadata" AS "metadataContacto",
           c."channelId" AS "canalId", w."name" AS "linea", w."purpose" AS "proposito", w."metadata" AS "metadataLinea",
           c."assignedToUserId" AS "asesoraId", u."name" AS "asesora",
           pm."createdAt" AS "primero", pm."content" AS "texto",
           EXISTS (SELECT 1 FROM "EmbudoLead" e WHERE e."conversationId" = c."id" AND e."anuncioId" IS NOT NULL) AS "anuncioEnEmbudo",
           EXISTS (SELECT 1 FROM "ContactTag" k JOIN "Tag" t ON t."id" = k."tagId"
                    WHERE k."contactId" = ct."id" AND t."slug" = ${SLUG_MARKETPLACE}) AS "etiquetaMarketplace"
      FROM "Conversation" c
      JOIN "Contact" ct ON ct."id" = c."contactId"
      LEFT JOIN "WhatsAppChannel" w ON w."id" = c."channelId"
      LEFT JOIN "User" u ON u."id" = c."assignedToUserId"
      JOIN LATERAL (
        SELECT x."createdAt", x."content"
          FROM "Message" x
         WHERE x."conversationId" = c."id" AND x."direction" = 'INBOUND'
           AND x."deletedAt" IS NULL AND x."isStatusBroadcast" = false
         ORDER BY x."createdAt" ASC
         LIMIT 1) pm ON true
     WHERE c."workspaceId" = ${workspaceId}
       AND c."contactId" IN (${Prisma.join(ids)})`);

  const filas: FilaDeLeadNuevo[] = crudas.map((f) => ({
    telefono: f.telefono,
    primerMensajeEn: f.primero,
    primerTexto: f.texto,
    canalId: f.canalId,
    linea: f.linea,
    proposito: f.proposito,
    metadataLinea: f.metadataLinea,
    metadataContacto: f.metadataContacto,
    anuncioEnEmbudo: Boolean(f.anuncioEnEmbudo),
    etiquetaMarketplace: Boolean(f.etiquetaMarketplace),
    asesoraId: f.asesoraId,
    asesora: f.asesora,
  }));

  const mapa = await leerMapaDeLineas(workspaceId);
  let leads = leadsNuevosDeLasFilas(filas, fecha, mapa);
  if (opciones.asesoraId) leads = leads.filter((l) => l.asesoraId === opciones.asesoraId);
  return { ...agruparLeads(leads, fecha), advertencias };
}
