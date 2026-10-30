import { Prisma } from "@prisma/client";

import { registrarCambioDeEtapa } from "@/lib/historial-etapa";
import type { CrmStage } from "@/features/crm/types";
import { avisoSiNoSePuedeDescartar } from "@/features/crm/services/candado-descarte-sin-respuesta";
import { condicionRecuperacionVencida } from "@/features/recuperacion/servicios/alarma";
import {
  cancelarAutomaticosPendientesDelContacto,
  createFollow,
  createFollowsFromRulesForSource,
} from "@/features/seguimientos/services/follows";
import { getFlowReply } from "@/lib/agent-product-flow";
import { alCambiarEstadoDelChat } from "@/lib/al-resolver-chat";
import { leerConfigAntiBloqueo } from "@/lib/anti-bloqueo/servicio";
import { leerColaboradores } from "@/lib/channel-collaborators";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { buildSnoozeMetadata } from "@/lib/lead-snooze";
import { prisma } from "@/lib/prisma";
import { notifyRealtimeUpdate } from "@/lib/realtime-notify";

import { destinoDeAsignacion, type FotoDelLead } from "./dominio/condiciones";
import { comoEjecucion, ejecutarAutomatizacion, type EnvioAgendado, type Puertos, type ResultadoDeEjecucion } from "./dominio/ejecutar";
import {
  MAXIMO_POR_EJECUCION,
  PASOS_GUARDADOS_ALTOS,
  PREFIJO_FOLLOW_AUTOMATIZACION,
  RESPONDIO,
  SIN_ASIGNAR,
  conEjecucion,
  idCortoDelEnvio,
  leTocaAlReloj,
  leerAutomatizacionGuardada,
  loQuePideYaPaso,
  nombreDelEnvio,
  tieneEnvios,
  type Accion,
  type Automatizacion,
  type Condicion,
  type Ejecucion,
} from "./dominio/modelo";

/**
 * AUTOMATIZACIONES: lo que necesita la base (la regla está en dominio/).
 *
 * Se guardan en AppSetting `crm:automatizaciones:<workspaceId>` como JSON, no en una tabla propia:
 * son pocas por negocio y una migración en la base de PRODUCCIÓN es un riesgo que esto no
 * justifica. Las guardadas con la forma vieja (asignar y nada más) se migran al leerlas.
 *
 * "Ya procesado por esta automatización" = la nota que deja en el chat (Message SYSTEM con
 * rawPayload.automatizacionId). Es a la vez el registro visible y la marca para no repetir.
 */

const PREFIJO_CLAVE = "crm:automatizaciones:";
const claveDe = (workspaceId: string) => `${PREFIJO_CLAVE}${workspaceId}`;
const claveDelCandado = (id: string) => `crm:automatizacion:corriendo:${id}`;
const MINUTOS_DEL_CANDADO = 10;
const DIA = 86_400_000;

export const ORIGEN_AUTOMATIZACION = "automatizacion";

/* ------------------------------------------------------------------------------------------------
   GUARDAR Y LEER
------------------------------------------------------------------------------------------------ */

export async function leerAutomatizaciones(workspaceId: string): Promise<Automatizacion[]> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDe(workspaceId) } });
  if (!fila?.value) return [];
  try {
    const datos = JSON.parse(fila.value);
    if (!Array.isArray(datos)) return [];
    return datos.map(leerAutomatizacionGuardada).filter((a): a is Automatizacion => a !== null);
  } catch {
    // Un valor ilegible no puede dejar la pantalla sin abrir: se empieza de cero.
    return [];
  }
}

export async function guardarAutomatizaciones(workspaceId: string, lista: Automatizacion[]) {
  const value = JSON.stringify(lista);
  await prisma.appSetting.upsert({
    where: { key: claveDe(workspaceId) },
    create: { key: claveDe(workspaceId), value },
    update: { value },
  });
}

/** Cambia UNA automatización volviendo a leer la lista justo antes (el reloj y la pantalla escriben la misma fila). */
export async function actualizarAutomatizacion(workspaceId: string, id: string, cambio: (a: Automatizacion) => Automatizacion) {
  const lista = await leerAutomatizaciones(workspaceId);
  if (!lista.some((a) => a.id === id)) return;
  await guardarAutomatizaciones(
    workspaceId,
    lista.map((a) => (a.id === id ? cambio(a) : a)),
  );
}

/* ------------------------------------------------------------------------------------------------
   EL FILTRO EN SQL (alias c = Conversation, ct = Contact). Lo mismo que dominio/condiciones.ts.
------------------------------------------------------------------------------------------------ */

type Criterios = Pick<Automatizacion, "condiciones" | "soloAbiertas" | "acciones">;

/**
 * La clienta escribió después de nuestro primer mensaje. Es la regla de `respondioLaBienvenida`
 * (src/lib/turno-con-contenido.ts) en SQL: notas del sistema y mensajes borrados no cuentan; sin
 * mensaje nuestro, min() es NULL y no cumple. Usa el índice (conversationId, direction, createdAt).
 */
const SQL_RESPONDIO = Prisma.sql`EXISTS (
  SELECT 1 FROM "Message" mi
   WHERE mi."conversationId" = c."id" AND mi."direction" = 'INBOUND' AND mi."type" <> 'SYSTEM' AND mi."deletedAt" IS NULL
     AND mi."createdAt" > (SELECT min(mo."createdAt") FROM "Message" mo
                            WHERE mo."conversationId" = c."id" AND mo."direction" = 'OUTBOUND' AND mo."type" <> 'SYSTEM' AND mo."deletedAt" IS NULL))`;
const SQL_PASO_ACTUAL = Prisma.sql`COALESCE((SELECT e."pasoActual" FROM "EmbudoLead" e WHERE e."conversationId" = c."id"), '')`;
const SQL_PASO_MAXIMO = Prisma.sql`COALESCE((SELECT e."pasoMaximo" FROM "EmbudoLead" e WHERE e."conversationId" = c."id"), '')`;

/** "Paso del embudo" en SQL: lo mismo que `cumpleCondicion` (dominio/condiciones.ts). */
function sqlDePasoDelEmbudo(condicion: Extract<Condicion, { campo: "paso_embudo" }>): Prisma.Sql {
  const valores: readonly string[] = condicion.valores;
  if (condicion.operador === "ya_paso") {
    const pide = loQuePideYaPaso(valores);
    if (pide.nunca) return Prisma.sql`FALSE`;
    if (pide.bastaResponder) return SQL_RESPONDIO;
    const guardados = Prisma.join(pide.guardados);
    return Prisma.sql`(${SQL_RESPONDIO} AND (${SQL_PASO_MAXIMO} IN (${guardados}) OR ${SQL_PASO_ACTUAL} IN (${guardados})))`;
  }
  // "es": en Bienvenida (o sin paso) cuenta como Respondió o Bienvenida según sus mensajes.
  const partes: Prisma.Sql[] = [];
  const altos = PASOS_GUARDADOS_ALTOS.filter((p) => valores.includes(p));
  if (altos.length) partes.push(Prisma.sql`${SQL_PASO_ACTUAL} IN (${Prisma.join(altos)})`);
  const enBienvenida = Prisma.sql`${SQL_PASO_ACTUAL} NOT IN (${Prisma.join([...PASOS_GUARDADOS_ALTOS])})`;
  if (valores.includes("PRESENTACION")) partes.push(Prisma.sql`(${enBienvenida} AND NOT ${SQL_RESPONDIO})`);
  if (valores.includes(RESPONDIO)) partes.push(Prisma.sql`(${enBienvenida} AND ${SQL_RESPONDIO})`);
  return partes.length ? Prisma.sql`(${Prisma.join(partes, " OR ")})` : Prisma.sql`FALSE`;
}

function sqlDeCondicion(condicion: Condicion, ahora: Date, recuperacion: Prisma.Sql): Prisma.Sql {
  switch (condicion.campo) {
    case "etapa": {
      const dentro = Prisma.sql`ct."crmStage"::text IN (${Prisma.join(condicion.valores)})`;
      return condicion.operador === "es" ? dentro : Prisma.sql`NOT (${dentro})`;
    }
    case "asignado": {
      const ids = condicion.valores.filter((v) => v !== SIN_ASIGNAR);
      const partes: Prisma.Sql[] = [];
      if (ids.length) partes.push(Prisma.sql`COALESCE(c."assignedToUserId", '') IN (${Prisma.join(ids)})`);
      if (condicion.valores.includes(SIN_ASIGNAR)) partes.push(Prisma.sql`c."assignedToUserId" IS NULL`);
      const dentro = partes.length ? Prisma.sql`(${Prisma.join(partes, " OR ")})` : Prisma.sql`FALSE`;
      return condicion.operador === "es" ? dentro : Prisma.sql`NOT ${dentro}`;
    }
    case "etiquetas": {
      const alguna = Prisma.sql`EXISTS (SELECT 1 FROM "ContactTag" t WHERE t."contactId" = ct."id" AND t."tagId" IN (${Prisma.join(condicion.valores)}))`;
      return condicion.operador === "tiene" ? alguna : Prisma.sql`NOT ${alguna}`;
    }
    case "canal": {
      const dentro = Prisma.sql`COALESCE(c."channelId", '') IN (${Prisma.join(condicion.valores)})`;
      return condicion.operador === "es" ? dentro : Prisma.sql`NOT (${dentro})`;
    }
    case "dias_sin_responder":
      return Prisma.sql`(SELECT max(m."createdAt") FROM "Message" m
                          WHERE m."conversationId" = c."id" AND m."direction" = 'INBOUND' AND m."type" <> 'SYSTEM' AND m."deletedAt" IS NULL)
                        <= ${new Date(ahora.getTime() - condicion.dias * DIA)}`;
    case "dias_sin_mensajes":
      return Prisma.sql`c."lastMessageAt" <= ${new Date(ahora.getTime() - condicion.dias * DIA)}`;
    case "recuperacion_vencida":
      return condicion.operador === "si" ? recuperacion : Prisma.sql`NOT ${recuperacion}`;
    case "paso_embudo":
      return sqlDePasoDelEmbudo(condicion);
  }
}

/** El WHERE completo. `automatizacionId`: saca los que esa automatización ya procesó. */
async function dondeDe(workspaceId: string, criterios: Criterios, ahora: Date, automatizacionId: string | null) {
  const recuperacion = await condicionRecuperacionVencida(workspaceId, ahora);
  const partes: Prisma.Sql[] = [Prisma.sql`c."workspaceId" = ${workspaceId}`];
  if (criterios.soloAbiertas) partes.push(Prisma.sql`c."status" IN ('OPEN', 'PENDING')`);
  // Con "Asignar a X": nunca los que ya son de X ("asignarle 20" son 20 NUEVOS), y nunca chats que
  // no respondieron la bienvenida (regla vigente; igual en cumpleCondiciones).
  const destino = destinoDeAsignacion(criterios.acciones);
  if (destino) {
    partes.push(Prisma.sql`COALESCE(c."assignedToUserId", '') <> ${destino}`);
    partes.push(SQL_RESPONDIO);
  }
  // Con envíos: nunca Ganado / Descartado ni ocultos del CRM.
  if (tieneEnvios(criterios.acciones)) {
    partes.push(Prisma.sql`ct."crmStage"::text NOT IN ('GANADO', 'PERDIDO') AND ct."excludedFromCrm" = false`);
  }
  if (automatizacionId) {
    partes.push(Prisma.sql`NOT EXISTS (
      SELECT 1 FROM "Message" mp
       WHERE mp."conversationId" = c."id" AND mp."type" = 'SYSTEM' AND mp."rawPayload"->>'automatizacionId' = ${automatizacionId})`);
  }
  for (const condicion of criterios.condiciones) partes.push(sqlDeCondicion(condicion, ahora, recuperacion));
  return { donde: Prisma.join(partes, " AND "), recuperacion };
}

/* ------------------------------------------------------------------------------------------------
   CONTAR Y VISTA PREVIA
------------------------------------------------------------------------------------------------ */

export type Conteo = { total: number; tomaria: number; noLoVeria: number };

/**
 * Cuántos leads tomaría ahora (sin los que ya procesó), y cuántos de esos la persona de "Asignar"
 * NO podría ver (un canal con colaboradores solo se le muestra a ellos).
 */
export async function contarLeads(
  workspaceId: string,
  automatizacion: Criterios & { id?: string; cantidad: number | null },
  ahora = new Date(),
): Promise<Conteo> {
  const { donde } = await dondeDe(workspaceId, automatizacion, ahora, automatizacion.id ?? null);
  const porCanal = await prisma.$queryRaw<Array<{ channelId: string | null; total: bigint | number }>>(Prisma.sql`
    SELECT c."channelId", count(*) AS "total"
      FROM "Conversation" c JOIN "Contact" ct ON ct."id" = c."contactId"
     WHERE ${donde}
     GROUP BY 1`);
  const total = porCanal.reduce((suma, fila) => suma + Number(fila.total), 0);
  let noLoVeria = 0;
  const destino = destinoDeAsignacion(automatizacion.acciones);
  if (destino && total > 0) {
    const canales = await prisma.whatsAppChannel.findMany({ where: { workspaceId }, select: { id: true, metadata: true } });
    noLoVeria = porCanal.reduce((suma, fila) => {
      const canal = canales.find((item) => item.id === fila.channelId);
      const colaboradores = canal ? leerColaboradores(canal.metadata) : [];
      return colaboradores.length > 0 && !colaboradores.includes(destino) ? suma + Number(fila.total) : suma;
    }, 0);
  }
  const tope = Math.min(automatizacion.cantidad ?? MAXIMO_POR_EJECUCION, MAXIMO_POR_EJECUCION);
  return { total, tomaria: Math.min(total, tope), noLoVeria };
}

type FilaDelLead = {
  conversationId: string;
  contactId: string;
  channelId: string | null;
  etapa: string;
  asignadoA: string | null;
  etiquetas: string[] | null;
  abierta: boolean;
  excluido: boolean;
  ultimoMensajeEn: Date | null;
  ultimoClienteEn: Date | null;
  recuperacionVencida: boolean;
  pasoActual: string | null;
  pasoMaximo: string | null;
  respondio: boolean;
  nombre: string | null;
  telefono: string | null;
  asesora: string | null;
  linea: string | null;
};

async function leerLeads(workspaceId: string, automatizacion: Criterios & { id?: string }, limite: number, ahora: Date): Promise<FilaDelLead[]> {
  const { donde, recuperacion } = await dondeDe(workspaceId, automatizacion, ahora, automatizacion.id ?? null);
  return prisma.$queryRaw<FilaDelLead[]>(Prisma.sql`
    SELECT c."id" AS "conversationId", c."contactId", c."channelId", ct."crmStage"::text AS "etapa",
           c."assignedToUserId" AS "asignadoA",
           (SELECT array_agg(t."tagId") FROM "ContactTag" t WHERE t."contactId" = ct."id") AS "etiquetas",
           (c."status" IN ('OPEN', 'PENDING')) AS "abierta", ct."excludedFromCrm" AS "excluido",
           c."lastMessageAt" AS "ultimoMensajeEn",
           (SELECT max(m."createdAt") FROM "Message" m
             WHERE m."conversationId" = c."id" AND m."direction" = 'INBOUND' AND m."type" <> 'SYSTEM' AND m."deletedAt" IS NULL) AS "ultimoClienteEn",
           (CASE WHEN ${recuperacion} THEN true ELSE false END) AS "recuperacionVencida",
           eb."pasoActual", eb."pasoMaximo", (CASE WHEN ${SQL_RESPONDIO} THEN true ELSE false END) AS "respondio",
           NULLIF(btrim(ct."name"), '') AS "nombre", ct."phoneNumber" AS "telefono",
           u."name" AS "asesora", w."name" AS "linea"
      FROM "Conversation" c
      JOIN "Contact" ct ON ct."id" = c."contactId"
      LEFT JOIN "User" u ON u."id" = c."assignedToUserId"
      LEFT JOIN "WhatsAppChannel" w ON w."id" = c."channelId"
      LEFT JOIN "EmbudoLead" eb ON eb."conversationId" = c."id"
     WHERE ${donde}
     ORDER BY c."lastMessageAt" DESC NULLS LAST
     LIMIT ${limite}`);
}

function aFoto(fila: FilaDelLead): FotoDelLead {
  return {
    conversationId: fila.conversationId,
    contactId: fila.contactId,
    channelId: fila.channelId,
    etapa: fila.etapa as FotoDelLead["etapa"],
    asignadoA: fila.asignadoA,
    etiquetas: fila.etiquetas ?? [],
    abierta: Boolean(fila.abierta),
    excluido: Boolean(fila.excluido),
    ultimoMensajeEn: fila.ultimoMensajeEn ? new Date(fila.ultimoMensajeEn) : null,
    ultimoClienteEn: fila.ultimoClienteEn ? new Date(fila.ultimoClienteEn) : null,
    recuperacionVencida: Boolean(fila.recuperacionVencida),
    pasoActual: fila.pasoActual,
    pasoMaximo: fila.pasoMaximo,
    respondio: Boolean(fila.respondio),
  };
}

export type LeadDeLaVistaPrevia = {
  conversationId: string;
  nombre: string;
  telefonoFinal: string | null;
  etapa: string;
  asesora: string | null;
  linea: string | null;
  ultimoClienteEn: string | null;
  recuperacionVencida: boolean;
};

/** Cuántos y cuáles (los primeros `limite`, con lo necesario para abrir el chat). */
export async function vistaPrevia(
  workspaceId: string,
  automatizacion: Criterios & { id?: string; cantidad: number | null },
  limite = 50,
): Promise<{ conteo: Conteo; leads: LeadDeLaVistaPrevia[] }> {
  const ahora = new Date();
  const [conteo, filas] = await Promise.all([contarLeads(workspaceId, automatizacion, ahora), leerLeads(workspaceId, automatizacion, limite, ahora)]);
  return {
    conteo,
    leads: filas.map((fila) => {
      const telefono = (fila.telefono ?? "").replace(/\D/g, "");
      return {
        conversationId: fila.conversationId,
        nombre: fila.nombre ?? "Cliente",
        telefonoFinal: telefono.length >= 7 && telefono.length <= 13 ? telefono.slice(-4) : null,
        etapa: fila.etapa,
        asesora: fila.asesora?.trim().split(/\s+/)[0] ?? null,
        linea: fila.linea,
        ultimoClienteEn: fila.ultimoClienteEn ? new Date(fila.ultimoClienteEn).toISOString() : null,
        recuperacionVencida: Boolean(fila.recuperacionVencida),
      };
    }),
  };
}

/* ------------------------------------------------------------------------------------------------
   REFERENCIAS: lo que nombran las acciones y condiciones tiene que existir HOY
------------------------------------------------------------------------------------------------ */

export type Nombres = { personas: Map<string, string>; etiquetas: Map<string, string>; canales: Map<string, string> };

export async function validarReferencias(
  workspaceId: string,
  automatizacion: Pick<Automatizacion, "condiciones" | "acciones">,
): Promise<{ error: string } | { nombres: Nombres }> {
  const [miembros, etiquetas, canales] = await Promise.all([
    prisma.workspaceMember.findMany({ where: { workspaceId, isActive: true }, select: { userId: true, user: { select: { name: true, email: true } } } }),
    prisma.tag.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    prisma.whatsAppChannel.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
  ]);
  const nombres: Nombres = {
    personas: new Map(miembros.map((m) => [m.userId, m.user?.name?.trim() || m.user?.email || "un colaborador"])),
    etiquetas: new Map(etiquetas.map((t) => [t.id, t.name])),
    canales: new Map(canales.map((c) => [c.id, c.name])),
  };
  for (const accion of automatizacion.acciones) {
    if (accion.tipo === "asignar" && !nombres.personas.has(accion.usuarioId)) return { error: "La persona a quien asignar ya no es del equipo" };
    if ((accion.tipo === "anadir_etiqueta" || accion.tipo === "quitar_etiqueta") && !nombres.etiquetas.has(accion.etiquetaId)) {
      return { error: "Una etiqueta de las acciones ya no existe" };
    }
    if (accion.tipo === "enviar_flujo") {
      const flujo = await getFlowReply({ workspaceId, flowId: accion.flujoId, includeOfficialApi: false }).catch(() => null);
      if (!flujo || flujo.steps.length === 0) return { error: `El flujo «${accion.flujoNombre || "elegido"}» ya no existe o está vacío` };
    }
  }
  for (const condicion of automatizacion.condiciones) {
    if (condicion.campo === "canal" && condicion.valores.some((id) => !nombres.canales.has(id))) return { error: "Un canal de las condiciones ya no existe" };
    if (condicion.campo === "etiquetas" && condicion.valores.some((id) => !nombres.etiquetas.has(id))) return { error: "Una etiqueta de las condiciones ya no existe" };
  }
  return { nombres };
}

/** "asignar a María · enviar flujo «Audio» · enviar texto" (para la nota del chat). */
export function describirAcciones(acciones: ReadonlyArray<Accion>, nombres: Nombres): string {
  return acciones
    .map((a) => {
      switch (a.tipo) {
        case "asignar":
          return `asignar a ${nombres.personas.get(a.usuarioId) ?? "alguien"}`;
        case "anadir_etiqueta":
          return `etiqueta «${nombres.etiquetas.get(a.etiquetaId) ?? "?"}»`;
        case "quitar_etiqueta":
          return `quitar «${nombres.etiquetas.get(a.etiquetaId) ?? "?"}»`;
        case "resolver":
          return "resolver";
        case "abrir":
          return "abrir";
        case "posponer":
          return a.hasta ? "posponer" : `posponer ${a.dias} d`;
        case "enviar_flujo":
          return `enviar flujo «${a.flujoNombre || "flujo"}»`;
        case "enviar_texto":
          return "enviar texto";
        case "nota":
          return "nota";
        case "cambiar_etapa":
          return `etapa ${a.etapa}`;
      }
    })
    .join(" · ");
}

/* ------------------------------------------------------------------------------------------------
   EJECUTAR
------------------------------------------------------------------------------------------------ */

/** Candado por automatización (10 min): dos corridas a la vez no se pisan. true = lo tomó. */
async function tomarCandado(id: string, ahora: Date): Promise<boolean> {
  const hasta = new Date(ahora.getTime() + MINUTOS_DEL_CANDADO * 60_000).toISOString();
  const filas = await prisma.$queryRaw<Array<{ key: string }>>(Prisma.sql`
    INSERT INTO "AppSetting" ("key", "value", "createdAt", "updatedAt")
    VALUES (${claveDelCandado(id)}, ${hasta}, NOW(), NOW())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
     WHERE "AppSetting"."value" < ${ahora.toISOString()}
    RETURNING "key"`);
  return filas.length > 0;
}

async function soltarCandado(id: string) {
  await prisma.appSetting
    .update({ where: { key: claveDelCandado(id) }, data: { value: new Date(0).toISOString() } })
    .catch(() => undefined);
}

function patronDelEnvio(id: string) {
  return `${PREFIJO_FOLLOW_AUTOMATIZACION}%#${id.slice(0, 6)}`;
}

type TipoDeActividad = Parameters<typeof recordConversationActivity>[0]["kind"];

function puertosDe(input: {
  workspaceId: string;
  automatizacion: Automatizacion;
  nombres: Nombres;
  quien: { id: string | null; nombre: string };
  horario: Puertos["horario"];
  ahora: Date;
}): Puertos {
  const { workspaceId, automatizacion, nombres, quien, ahora } = input;
  const etiqueta = `automatización «${automatizacion.nombre}»`;
  const actividad = (foto: FotoDelLead, kind: TipoDeActividad, text: string, extra: { assigneeUserId?: string } = {}) =>
    recordConversationActivity({
      workspaceId,
      conversationId: foto.conversationId,
      channelId: foto.channelId,
      contactId: foto.contactId,
      kind,
      actorUserId: quien.id,
      origen: ORIGEN_AUTOMATIZACION,
      text,
      ...extra,
    });

  return {
    horario: input.horario,
    buscarLeads: async (tope) => (await leerLeads(workspaceId, automatizacion, tope, ahora)).map(aFoto),
    ultimoEnvioAgendado: async () => {
      const fila = await prisma.follow.findFirst({
        where: { workspaceId, status: "PENDING", name: { startsWith: PREFIJO_FOLLOW_AUTOMATIZACION, endsWith: `#${automatizacion.id.slice(0, 6)}` } },
        orderBy: { executeAt: "desc" },
        select: { executeAt: true },
      });
      return fila?.executeAt ?? null;
    },
    marcarProcesado: async (foto) => {
      const ya = await prisma.message.findFirst({
        where: { conversationId: foto.conversationId, type: "SYSTEM", rawPayload: { path: ["automatizacionId"], equals: automatizacion.id } },
        select: { id: true },
      });
      if (ya) return false;
      await prisma.message.create({
        data: {
          workspaceId,
          conversationId: foto.conversationId,
          channelId: foto.channelId,
          contactId: foto.contactId,
          direction: "OUTBOUND",
          type: "SYSTEM",
          status: "SENT",
          content: `⚙️ Automatización «${automatizacion.nombre}» (${quien.nombre}): ${describirAcciones(automatizacion.acciones, nombres)}`,
          rawPayload: {
            source: "activity",
            kind: "note",
            origen: ORIGEN_AUTOMATIZACION,
            automatizacionId: automatizacion.id,
            actorUserId: quien.id,
          } as never,
        },
      });
      return true;
    },
    aplicar: async (accion, foto) => {
      switch (accion.tipo) {
        case "asignar": {
          if (foto.asignadoA === accion.usuarioId) return;
          await prisma.conversation.update({ where: { id: foto.conversationId }, data: { assignedToUserId: accion.usuarioId } });
          await actividad(foto, "assigned", `${quien.nombre} asignó a ${nombres.personas.get(accion.usuarioId) ?? "alguien"} (${etiqueta})`, {
            assigneeUserId: accion.usuarioId,
          });
          return;
        }
        case "anadir_etiqueta": {
          const { count } = await prisma.contactTag.createMany({
            data: [{ contactId: foto.contactId, tagId: accion.etiquetaId, workspaceId }],
            skipDuplicates: true,
          });
          if (!count) return;
          await createFollowsFromRulesForSource({ workspaceId, contactId: foto.contactId, sourceType: "TAG", sourceId: accion.etiquetaId });
          await actividad(foto, "tag_added", `${quien.nombre} agregó la etiqueta "${nombres.etiquetas.get(accion.etiquetaId) ?? "?"}" (${etiqueta})`);
          return;
        }
        case "quitar_etiqueta": {
          const { count } = await prisma.contactTag.deleteMany({ where: { contactId: foto.contactId, tagId: accion.etiquetaId } });
          if (!count) return;
          await actividad(foto, "tag_removed", `${quien.nombre} quitó la etiqueta "${nombres.etiquetas.get(accion.etiquetaId) ?? "?"}" (${etiqueta})`);
          return;
        }
        case "resolver":
        case "abrir": {
          const status = accion.tipo === "resolver" ? "CLOSED" : "OPEN";
          await prisma.conversation.update({
            where: { id: foto.conversationId },
            data: { status, closedAt: status === "CLOSED" ? new Date() : null },
          });
          // Igual que el botón: resuelto = fuera de tareas y automáticos (ver lib/al-resolver-chat).
          alCambiarEstadoDelChat({
            workspaceId,
            conversationId: foto.conversationId,
            contactId: foto.contactId,
            anterior: foto.abierta ? "OPEN" : "CLOSED",
            nuevo: status,
          });
          await actividad(foto, status === "CLOSED" ? "resolved" : "reopened", `${quien.nombre} ${status === "CLOSED" ? "resolvió" : "reabrió"} (${etiqueta})`);
          await notifyRealtimeUpdate({
            workspaceId,
            conversationId: foto.conversationId,
            type: "chat-estado",
            data: { source: "agent", resolved: status === "CLOSED" },
          }).catch(() => undefined);
          return;
        }
        case "posponer": {
          const hasta = accion.hasta ? new Date(accion.hasta) : new Date(ahora.getTime() + (accion.dias ?? 1) * DIA);
          const contacto = await prisma.contact.findUnique({ where: { id: foto.contactId }, select: { metadata: true } });
          await prisma.contact.update({
            where: { id: foto.contactId },
            data: { metadata: buildSnoozeMetadata(contacto?.metadata ?? null, hasta) as Prisma.InputJsonValue },
          });
          return;
        }
        case "nota":
          await actividad(foto, "note", `📝 Automatización «${automatizacion.nombre}»: ${accion.texto}`);
          return;
        case "cambiar_etapa": {
          if (foto.etapa === accion.etapa) return;
          if (accion.etapa === "PERDIDO") {
            const aviso = await avisoSiNoSePuedeDescartar({ contactId: foto.contactId, lostReason: accion.motivoPerdida });
            if (aviso) throw new Error(`No se descartó: ${aviso}`);
          }
          await prisma.$executeRaw`
            UPDATE "Contact"
               SET "crmStage" = ${accion.etapa}::"CrmStage",
                   "lostReason" = ${accion.etapa === "PERDIDO" ? accion.motivoPerdida : null},
                   "wonAt" = NULL, "wonQuoteRef" = NULL, "updatedAt" = NOW()
             WHERE "id" = ${foto.contactId} AND "crmStage"::text <> 'GANADO'`;
          await registrarCambioDeEtapa({
            workspaceId,
            contactId: foto.contactId,
            conversationId: foto.conversationId,
            etapaAnterior: foto.etapa,
            etapaNueva: accion.etapa,
            origen: "AUTOMATICO",
            nota: `automatización «${automatizacion.nombre}»`,
          });
          if (accion.etapa === "PERDIDO") {
            await cancelarAutomaticosPendientesDelContacto({ workspaceId, contactId: foto.contactId, motivo: "etapa_cerrada" });
          }
          await createFollowsFromRulesForSource({ workspaceId, contactId: foto.contactId, sourceType: "CRM_STAGE", sourceId: accion.etapa as CrmStage });
          await actividad(foto, "stage_changed", `${quien.nombre} cambió la etapa a "${accion.etapa}" (${etiqueta})`);
          return;
        }
        case "enviar_flujo":
        case "enviar_texto":
          // Los envíos no pasan por acá: se agendan (agendarEnvio).
          return;
      }
    },
    agendarEnvio: async (foto, envios: EnvioAgendado[], en) => {
      const acciones = envios.map((envio, i) =>
        envio.tipo === "enviar_flujo"
          ? { order: i + 1, messageType: "TEXT" as const, content: `Flujo: ${envio.flujoNombre || "flujo"}`, flowId: envio.flujoId }
          : { order: i + 1, messageType: "TEXT" as const, content: envio.texto },
      );
      const follow = await createFollow({
        workspaceId,
        contactId: foto.contactId,
        channelId: foto.channelId,
        name: nombreDelEnvio(automatizacion),
        timeType: "MINUTES",
        timeValue: 1,
        executeAt: en,
        messageType: "TEXT",
        content: acciones[0]?.content ?? null,
        actions: acciones,
        // Si el cliente escribe antes de que salga, ya no hace falta: vuelve el flujo normal.
        cancelOnActivity: true,
      });
      if (!follow) throw new Error("No se pudo agendar el envío");
    },
  };
}

/**
 * Corre una automatización: valida referencias, toma el candado, aplica y deja la fila en el
 * historial. `origen` "automatica" = el reloj.
 */
export async function correrAutomatizacion(input: {
  workspaceId: string;
  automatizacion: Automatizacion;
  quien: { id: string | null; nombre: string };
  origen: Ejecucion["origen"];
  ahora?: Date;
}): Promise<{ error: string } | { resultado: ResultadoDeEjecucion; ejecucion: Ejecucion }> {
  const ahora = input.ahora ?? new Date();
  const { workspaceId, automatizacion } = input;
  const referencias = await validarReferencias(workspaceId, automatizacion);
  if ("error" in referencias) {
    const ejecucion: Ejecucion = {
      fecha: ahora.toISOString(),
      por: input.quien.nombre,
      origen: input.origen,
      leads: 0,
      envios: 0,
      errores: 1,
      detalle: [referencias.error],
    };
    await actualizarAutomatizacion(workspaceId, automatizacion.id, (a) => ({
      ...a,
      historial: conEjecucion(a.historial, ejecucion),
      ultimaAutomaticaEn: input.origen === "automatica" ? ahora.toISOString() : a.ultimaAutomaticaEn,
    }));
    return { error: referencias.error };
  }
  if (!(await tomarCandado(automatizacion.id, ahora))) return { error: "Esa automatización ya está corriendo. Prueba en unos minutos." };
  try {
    const antiBloqueo = await leerConfigAntiBloqueo(workspaceId);
    // Horario del anti-bloqueo; apagado, igual 8–20 (Bogotá): de noche no se le escribe a nadie.
    const horario = antiBloqueo.horario.activo ? antiBloqueo.horario : { ...antiBloqueo.horario, activo: true, desdeHora: 8, hastaHora: 20 };
    const resultado = await ejecutarAutomatizacion(
      automatizacion,
      puertosDe({ workspaceId, automatizacion, nombres: referencias.nombres, quien: input.quien, horario, ahora }),
      ahora,
    );
    const ejecucion = comoEjecucion(resultado, { fecha: ahora, por: input.quien.nombre, origen: input.origen });
    if (resultado.errores.length) {
      console.warn("[automatizaciones] errores al ejecutar", { automatizacionId: automatizacion.id, errores: resultado.errores.slice(0, 10) });
    }
    // El reloj solo deja fila cuando hizo algo (si no, cada 30 min taparía las corridas de verdad).
    const anotar = input.origen === "manual" || resultado.leads > 0 || resultado.errores.length > 0;
    await actualizarAutomatizacion(workspaceId, automatizacion.id, (a) => ({
      ...a,
      historial: anotar ? conEjecucion(a.historial, ejecucion) : a.historial,
      ultimaAutomaticaEn: input.origen === "automatica" ? ahora.toISOString() : a.ultimaAutomaticaEn,
    }));
    return { resultado, ejecucion };
  } finally {
    await soltarCandado(automatizacion.id);
  }
}

/* ------------------------------------------------------------------------------------------------
   ENVÍOS AGENDADOS (lo que se ve en la tarjeta) y DETENER
------------------------------------------------------------------------------------------------ */

export type EstadoDeEnvios = { pendientes: number; enviados: number; frenados: number; fallidos: number; proximoEn: string | null };

/** Por id corto de automatización: cuántos envíos esperan, salieron, se frenaron o fallaron. */
export async function estadoDeEnvios(workspaceId: string): Promise<Map<string, EstadoDeEnvios>> {
  const filas = await prisma.$queryRaw<Array<{ name: string | null; status: string; conError: boolean; total: bigint | number; proximo: Date | null }>>(Prisma.sql`
    SELECT f."name", f."status"::text AS "status", (f."executionError" IS NOT NULL) AS "conError",
           count(*) AS "total", min(f."executeAt") AS "proximo"
      FROM "Follow" f
     WHERE f."workspaceId" = ${workspaceId} AND f."name" LIKE ${`${PREFIJO_FOLLOW_AUTOMATIZACION}%`}
     GROUP BY 1, 2, 3`);
  const mapa = new Map<string, EstadoDeEnvios>();
  for (const fila of filas) {
    const id = idCortoDelEnvio(fila.name);
    if (!id) continue;
    const e = mapa.get(id) ?? { pendientes: 0, enviados: 0, frenados: 0, fallidos: 0, proximoEn: null };
    const n = Number(fila.total);
    if (fila.status === "PENDING") {
      e.pendientes += n;
      const proximo = fila.proximo ? new Date(fila.proximo).toISOString() : null;
      if (proximo && (!e.proximoEn || proximo < e.proximoEn)) e.proximoEn = proximo;
    } else if (fila.status === "CANCELLED") e.frenados += n;
    else if (fila.conError) e.fallidos += n;
    else e.enviados += n;
    mapa.set(id, e);
  }
  return mapa;
}

/** Cancela los envíos que esta automatización todavía no mandó. */
export async function detenerEnvios(workspaceId: string, id: string): Promise<number> {
  return prisma.$executeRaw(Prisma.sql`
    UPDATE "Follow"
       SET "status" = 'CANCELLED', "cancelledAt" = NOW(), "executionError" = 'detenido_desde_automatizaciones', "updatedAt" = NOW()
     WHERE "workspaceId" = ${workspaceId} AND "status" = 'PENDING' AND "lockedAt" IS NULL
       AND "name" LIKE ${patronDelEnvio(id)}`);
}

/* ------------------------------------------------------------------------------------------------
   EL RELOJ: las automáticas, cada 30 minutos
------------------------------------------------------------------------------------------------ */

let corriendo = false;

/** Desde el cron (cada minuto; cada automatización se fija si ya pasaron 30 min). Nunca lanza. */
export async function correrAutomatizacionesDelReloj(ahora = new Date()): Promise<{ corridas: number; leads: number; envios: number }> {
  const total = { corridas: 0, leads: 0, envios: 0 };
  if (corriendo) return total;
  corriendo = true;
  try {
    const filas = await prisma.appSetting.findMany({ where: { key: { startsWith: PREFIJO_CLAVE } }, select: { key: true } });
    for (const fila of filas) {
      const workspaceId = fila.key.slice(PREFIJO_CLAVE.length);
      const lista = await leerAutomatizaciones(workspaceId).catch(() => [] as Automatizacion[]);
      for (const automatizacion of lista) {
        if (!leTocaAlReloj(automatizacion, ahora)) continue;
        try {
          const r = await correrAutomatizacion({ workspaceId, automatizacion, quien: { id: null, nombre: "Automática" }, origen: "automatica", ahora });
          total.corridas += 1;
          if ("resultado" in r) {
            total.leads += r.resultado.leads;
            total.envios += r.resultado.envios;
          }
        } catch (error) {
          console.error("[automatizaciones] fallo una automatica", {
            workspaceId,
            id: automatizacion.id,
            error: error instanceof Error ? error.message : String(error),
          });
          // Igual espera 30 min para no insistir cada minuto.
          await actualizarAutomatizacion(workspaceId, automatizacion.id, (a) => ({ ...a, ultimaAutomaticaEn: ahora.toISOString() })).catch(() => undefined);
        }
      }
    }
    return total;
  } catch (error) {
    console.error("[automatizaciones] fallo el reloj", error);
    return total;
  } finally {
    corriendo = false;
  }
}
