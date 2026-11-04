import { prisma } from "@/lib/prisma";
import {
  CLAVE_DESCARTE_POR_LECTURA,
  NOTA_ETAPA_AUTOMATICA,
  causaCorta,
  claveInterruptorDescarteAutomatico,
  claveInterruptorEtapaAutomatica,
  claveInterruptorGanadoAutomatico,
  etapaAutomaticaPrendida,
  etapaQueSePuedeLeer,
  moverEtapaAutomatica,
} from "@/lib/etapa-automatica-crm";
import {
  MOTIVOS_DE_DESCARTE,
  fechaDeRecontacto,
  fraseDelCliente,
  interpretarRespuestaDeLaIA,
  leerIntencionPorFrase,
  vaALaIA,
  type IntencionDeLaIA,
  type LecturaDelMensaje,
} from "@/features/crm/domain/intencion-del-cliente";
import { claveContadorDeIA } from "@/features/crm/services/barrido-de-etapas";
import type { CrmStage } from "@/features/crm/types";

/**
 * LA ETAPA POR LO QUE DICE EL CLIENTE (decisión del dueño, 23-oct-2026).
 *
 * Corre después de cada mensaje del cliente, en segundo plano (after() del webhook): no demora nada y
 * nunca lanza. Primero frases claras (gratis); si no hay ninguna, una pregunta corta a la IA del CRM,
 * que solo puede decir Caliente, Tibio, Frío o nada. Descartado sale SOLO de una frase clara y la IA
 * nunca pone Descartado ni Ganado. Pedir precio o fotos (Interesado) pasa a Frío solo un chat vacío ("---").
 *
 * Mueve la etapa con el motor de la etapa automática (src/lib/etapa-automatica-crm.ts), con todas sus
 * protecciones: nunca baja salvo a Descartado, no toca Ganado ni Perdido, ni "fuera del CRM", ni la
 * línea administrativa, y lo que una persona puso a mano nunca baja (ni a Descartado), por más tiempo que
 * haya pasado: solo sube. No le escribe al cliente: solo pone la etapa, la nota en el chat y la fecha de
 * recontacto.
 */

/** El modelo barato que ya usa el CRM para leer conversaciones. */
const MODELO = "gpt-4.1-mini";
const ESPERA_IA_MS = 8_000;

const SISTEMA = `Eres el clasificador del CRM de una tienda de mobiliario para estética (camillas, sillas, combos) en Colombia.
Lees UN mensaje de un cliente por WhatsApp y contestas con UNA palabra:
CALIENTE si quiere comprar ya: pregunta cómo pagar, pide datos para consignar, pide el total, elige color o modelo, dice su ciudad para el envío o manda sus datos.
TIBIO si muestra interés pero lo deja para después, duda o lo va a pensar.
FRIO si pregunta el precio o pide fotos.
NADA si solo saluda, pregunta información general o no se sabe.
Nunca contestes otra cosa.`;

async function preguntarALaIA(texto: string): Promise<IntencionDeLaIA | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODELO,
      temperature: 0,
      max_tokens: 3,
      messages: [
        { role: "system", content: SISTEMA },
        { role: "user", content: texto.slice(0, 600) },
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(ESPERA_IA_MS),
  });
  if (!respuesta.ok) throw new Error(`OpenAI respondió ${respuesta.status}`);
  const datos = (await respuesta.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return interpretarRespuestaDeLaIA(datos.choices?.[0]?.message?.content);
}

/** La nota de cada respuesta de la IA. */
const PORQUE_DE_LA_IA: Record<IntencionDeLaIA, string> = {
  CALIENTE: "el cliente mostró intención de compra",
  TIBIO: "el cliente lo deja para después",
  INTERESADO: "el cliente pidió precio o fotos",
};

/** La IA solo sube a Caliente, Tibio o Frío: a un Caliente no se le pregunta. */
const SIN_IA: CrmStage[] = ["NEGOCIACION"];

export async function etapaPorLectura(input: {
  workspaceId: string;
  source: "agent" | "official";
  conversationId: string;
  /** El texto del mensaje del cliente (null si no es texto: foto, audio, sticker). */
  texto: string | null;
  cuando?: Date;
}): Promise<CrmStage | null> {
  try {
    const texto = (input.texto ?? "").trim();
    if (!texto) return null;
    const cuando = input.cuando ?? new Date();

    // Primero las frases, sin tocar la base: un "ok" o un "gracias" no gasta ni una consulta.
    let lectura: LecturaDelMensaje | null = leerIntencionPorFrase(texto, cuando);
    if (!lectura && !vaALaIA(texto)) return null;
    if (!(await etapaAutomaticaPrendida(input.workspaceId))) return null;
    let metodo: "frase" | "ia" = "frase";
    if (!lectura) {
      // Solo si el chat se puede mover: ni línea Admin, ni "fuera del CRM", ni cerrado. Así esos mensajes
      // no salen a la IA ni gastan. Una etapa puesta a mano sí se lee: la IA solo sube.
      const etapa = await etapaQueSePuedeLeer(input);
      if (etapa && !SIN_IA.includes(etapa)) {
        // Si la IA no contesta (sin conexión, demora), no se mueve nada: lo intenta el próximo mensaje.
        const ia = await preguntarALaIA(texto).catch((falla) => {
          console.info(`[etapa-por-lectura] la IA no contestó conversationId=${input.conversationId} causa=${causaCorta(falla)}`);
          return null;
        });
        if (ia) {
          metodo = "ia";
          lectura = { intencion: ia, porque: PORQUE_DE_LA_IA[ia] };
        }
      }
    }
    if (!lectura) return null;

    const motivo = { tipo: "lectura" as const, porque: lectura.porque, metodo };
    const base = { workspaceId: input.workspaceId, source: input.source, conversationId: input.conversationId, motivo };
    let movida: CrmStage | null;
    if (lectura.intencion === "DESCARTADO" && lectura.descarte) {
      movida = await moverEtapaAutomatica({
        ...base,
        destino: "PERDIDO",
        descarte: { lostReason: MOTIVOS_DE_DESCARTE[lectura.descarte].lostReason, frase: fraseDelCliente(texto, 300) },
      });
    } else if (lectura.intencion === "TIBIO") {
      movida = await moverEtapaAutomatica({ ...base, destino: "PROPUESTA", recontactarEl: fechaDeRecontacto(texto, cuando).fecha });
    } else if (lectura.intencion === "INTERESADO") {
      // Pedir precio o fotos solo llena un chat vacío ("---"): un Tibio o un Caliente no cambian.
      movida = await moverEtapaAutomatica({ ...base, destino: "CALIFICADO", soloSiEstaVacio: true });
    } else if (lectura.intencion === "CALIENTE") {
      movida = await moverEtapaAutomatica({ ...base, destino: "NEGOCIACION" });
    } else {
      // Un Descartado sin motivo de la lista no mueve nada.
      movida = null;
    }
    // Cada decisión queda en el registro con su método; las que movieron, además, en el historial de etapas.
    console.info(
      `[etapa-por-lectura] decision conversationId=${input.conversationId} metodo=${metodo} intencion=${lectura.intencion} movida=${movida ?? "no"}`,
    );
    return movida;
  } catch (falla) {
    console.info(`[etapa-por-lectura] no leyó el mensaje conversationId=${input.conversationId} causa=${causaCorta(falla)}`);
    return null;
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* MEDIR (para la herramienta "qué es esta aplicación"): los últimos 7 días. */

const DIAS_DE_MEDICION = 7;
/** Si las asesoras revierten más que esto de los descartes automáticos, hay que endurecer la regla. */
const TOPE_DE_REVERSIONES = 0.05;

/** La meta del dueño: menos de este porcentaje de los chats de la semana sigue sin etapa ("---"). */
export const META_SIN_ETAPA = 10;

export type EstadoDelBarrido = {
  /** El barrido corre (crm:etapa-automatica:<negocio> no está en off). */
  prendido: boolean;
  /** El Ganado desde Gestión (crm:etapa-automatica:ganado:<negocio> no está en off). */
  ganado_automatico_prendido: boolean;
  /** Chats que leyó la IA del barrido hoy (hora de Colombia). null si no se pudo leer. */
  chats_leidos_por_ia_hoy: number | null;
  /** Leads que el barrido pasó a Ganado hoy desde las ventas de Gestión. null si no se pudo leer. */
  ganados_de_gestion_hoy: number | null;
};

export type EstadoDeEtapaPorLectura = {
  /** La frase de siempre: si está prendida y la medición de 7 días. */
  estado: string;
  /** Contactos que pasaron a Caliente hoy (hora de Colombia). null si no se pudo leer. */
  calientes_hoy: number | null;
  /** Los 7 últimos días, del más viejo a hoy. null si no se pudo leer. */
  calientes_por_dia: Array<{ fecha: string; calientes: number }> | null;
  /** De los chats de ventas con un mensaje del cliente en 7 días, qué % sigue en "---". null si no se pudo leer. */
  porcentaje_sin_etapa_semana: number | null;
  meta_sin_etapa: number;
  barrido: EstadoDelBarrido;
  /** Las mediciones que fallaron (la causa quedó en el registro). */
  no_se_pudo_leer?: string[];
};

/** El día en hora de Colombia (AAAA-MM-DD). Colombia no tiene horario de verano: siempre UTC-5. */
function diaDeColombia(cuando: Date): string {
  return new Date(cuando.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/** Las 00:00 de un día de Colombia, en UTC. */
function inicioDelDia(dia: string): Date {
  return new Date(`${dia}T05:00:00.000Z`);
}

export async function estadoDeEtapaPorLectura(workspaceId: string, ahora: Date = new Date()): Promise<EstadoDeEtapaPorLectura> {
  const fallas: string[] = [];
  /** Cada consulta por separado: si falla, queda en el registro con una causa corta y no lanza. */
  const medir = async <T,>(nombre: string, consulta: () => Promise<T>): Promise<T | null> => {
    try {
      return await consulta();
    } catch (falla) {
      fallas.push(nombre);
      console.info(`[etapa-por-lectura] no midió ${nombre} workspaceId=${workspaceId} causa=${causaCorta(falla)}`);
      return null;
    }
  };

  const hoy = diaDeColombia(ahora);
  const inicioDeHoy = inicioDelDia(hoy);
  const dias = Array.from({ length: DIAS_DE_MEDICION }, (_, i) =>
    diaDeColombia(new Date(inicioDeHoy.getTime() - (DIAS_DE_MEDICION - 1 - i) * 86_400_000)),
  );
  const desdeLaSemana = inicioDelDia(dias[0]);
  const desde = new Date(ahora.getTime() - DIAS_DE_MEDICION * 86_400_000);

  const [general, descarte, ganado, contador, calientes, sinEtapa, ganadosHoy] = await Promise.all([
    medir("el interruptor", () =>
      prisma.appSetting.findUnique({ where: { key: claveInterruptorEtapaAutomatica(workspaceId) }, select: { value: true } }),
    ),
    medir("el interruptor del descarte", () =>
      prisma.appSetting.findUnique({ where: { key: claveInterruptorDescarteAutomatico(workspaceId) }, select: { value: true } }),
    ),
    medir("el interruptor del Ganado", () =>
      prisma.appSetting.findUnique({ where: { key: claveInterruptorGanadoAutomatico(workspaceId) }, select: { value: true } }),
    ),
    medir("los chats leídos por la IA hoy", () =>
      prisma.appSetting.findUnique({ where: { key: claveContadorDeIA(workspaceId) }, select: { value: true } }),
    ),
    // Calientes: cada cambio a Caliente (NEGOCIACION) del historial, de cualquier origen, desde las 00:00 de
    // hace 6 días. Un contacto cuenta una vez por día.
    medir("los Calientes del día", () =>
      prisma.historialEtapa.findMany({
        where: { workspaceId, etapaNueva: "NEGOCIACION", creadoEn: { gte: desdeLaSemana } },
        select: { contactId: true, creadoEn: true },
      }),
    ),
    // Sin etapa: los contactos de la línea de ventas (sin los "fuera del CRM") con un mensaje del cliente
    // en los últimos 7 días, y cuántos de ellos siguen en "---" (NUEVO). Los mismos que lee el barrido.
    medir("los chats sin etapa", () =>
      prisma.$queryRaw<Array<{ total: bigint; sin_etapa: bigint }>>`
        SELECT COUNT(DISTINCT c."id") AS total,
               COUNT(DISTINCT c."id") FILTER (WHERE c."crmStage"::text = 'NUEVO') AS sin_etapa
        FROM "Contact" c
        JOIN "Conversation" v ON v."contactId" = c."id" AND v."workspaceId" = ${workspaceId}
        JOIN "WhatsAppChannel" w ON w."id" = v."channelId" AND w."purpose" = 'SALES'
        WHERE c."workspaceId" = ${workspaceId} AND c."excludedFromCrm" = false AND v."lastMessageAt" >= ${desde}
          AND EXISTS (
            SELECT 1 FROM "Message" m
            WHERE m."conversationId" = v."id" AND m."direction"::text = 'INBOUND'
              AND m."isStatusBroadcast" = false AND m."createdAt" >= ${desde}
          )
      `,
    ),
    // Ganados de Gestión de hoy: la marca "[gestion]" que deja marcarGanadoPorGestion en el historial.
    medir("los Ganados de Gestión de hoy", () =>
      prisma.historialEtapa.count({
        where: {
          workspaceId,
          origen: "AUTOMATICO",
          etapaNueva: "GANADO",
          creadoEn: { gte: inicioDeHoy },
          nota: { contains: "[gestion]" },
        },
      }),
    ),
  ]);

  const apagada = (fila: { value: string | null } | null) => fila?.value?.trim().toLowerCase() === "off";
  const prendida = !apagada(general);

  let calientesPorDia: EstadoDeEtapaPorLectura["calientes_por_dia"] = null;
  if (calientes) {
    const porDia = new Map<string, Set<string>>(dias.map((dia) => [dia, new Set()]));
    for (const fila of calientes) porDia.get(diaDeColombia(fila.creadoEn))?.add(fila.contactId);
    calientesPorDia = dias.map((fecha) => ({ fecha, calientes: porDia.get(fecha)?.size ?? 0 }));
  }

  let porcentajeSinEtapa: number | null = null;
  if (sinEtapa) {
    const total = Number(sinEtapa[0]?.total ?? 0);
    const sin = Number(sinEtapa[0]?.sin_etapa ?? 0);
    porcentajeSinEtapa = total > 0 ? Math.round((sin / total) * 100) : 0;
  }

  let leidosHoy: number | null = null;
  if (contador !== null) {
    try {
      const valor = JSON.parse(contador?.value ?? "{}") as { dia?: string; usados?: number };
      leidosHoy = valor.dia === hoy && Number.isFinite(valor.usados) ? Number(valor.usados) : 0;
    } catch {
      leidosHoy = 0;
    }
  }

  const texto = prendida
    ? await medicionDeLaSemana(workspaceId, desde, apagada(descarte)).catch((falla) => {
        fallas.push("la medición de 7 días");
        console.info(`[etapa-por-lectura] no midió la semana workspaceId=${workspaceId} causa=${causaCorta(falla)}`);
        return "activa (no se pudo leer la medición de 7 días)";
      })
    : "apagada (crm:etapa-automatica:<negocio> = off): no lee los mensajes del cliente";

  return {
    estado: texto,
    calientes_hoy: calientesPorDia ? calientesPorDia[calientesPorDia.length - 1].calientes : null,
    calientes_por_dia: calientesPorDia,
    porcentaje_sin_etapa_semana: porcentajeSinEtapa,
    meta_sin_etapa: META_SIN_ETAPA,
    barrido: {
      prendido: prendida,
      ganado_automatico_prendido: prendida && !apagada(ganado),
      chats_leidos_por_ia_hoy: leidosHoy,
      ganados_de_gestion_hoy: ganadosHoy,
    },
    ...(fallas.length > 0 ? { no_se_pudo_leer: fallas } : {}),
  };
}

/** La medición de 7 días de siempre: leads nuevos con etapa, movidos por frase o IA, descartes revertidos. */
async function medicionDeLaSemana(workspaceId: string, desde: Date, descarteApagado: boolean): Promise<string> {
  const prefijo = `${NOTA_ETAPA_AUTOMATICA}:%`;

  const [leads, porMetodo, reversiones] = await Promise.all([
    prisma.$queryRaw<Array<{ total: bigint; con_etapa: bigint }>>`
      SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE c."crmStage"::text <> 'NUEVO') AS con_etapa
      FROM "Contact" c
      WHERE c."workspaceId" = ${workspaceId} AND c."excludedFromCrm" = false AND c."createdAt" >= ${desde}
    `,
    prisma.$queryRaw<Array<{ metodo: string; cantidad: bigint }>>`
      SELECT CASE WHEN h."nota" LIKE '%[ia]' THEN 'ia' ELSE 'frase' END AS metodo, COUNT(*) AS cantidad
      FROM "HistorialEtapa" h
      WHERE h."workspaceId" = ${workspaceId} AND h."origen" = 'AUTOMATICO' AND h."creadoEn" >= ${desde}
        AND h."nota" LIKE ${prefijo} AND (h."nota" LIKE '%[ia]' OR h."nota" LIKE '%[frase]')
      GROUP BY 1
    `,
    prisma.$queryRaw<Array<{ descartados: bigint; revertidos: bigint }>>`
      SELECT COUNT(*) AS descartados,
             COALESCE(SUM(CASE WHEN EXISTS (
               SELECT 1 FROM "HistorialEtapa" p
               WHERE p."contactId" = h."contactId" AND p."origen" IN ('ASESORA', 'MCP')
                 AND p."etapaAnterior" = 'PERDIDO' AND p."creadoEn" > h."creadoEn"
             ) THEN 1 ELSE 0 END), 0) AS revertidos
      FROM "HistorialEtapa" h
      WHERE h."workspaceId" = ${workspaceId} AND h."origen" = 'AUTOMATICO' AND h."etapaNueva" = 'PERDIDO'
        AND h."creadoEn" >= ${desde} AND h."nota" LIKE ${prefijo} AND h."nota" LIKE '%[frase]'
    `,
  ]);

  const total = Number(leads[0]?.total ?? 0);
  const conEtapa = Number(leads[0]?.con_etapa ?? 0);
  const metodos = Object.fromEntries(porMetodo.map((fila) => [fila.metodo, Number(fila.cantidad)]));
  const descartados = Number(reversiones[0]?.descartados ?? 0);
  const revertidos = Number(reversiones[0]?.revertidos ?? 0);
  const porcentaje = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 100) : 0);
  const alerta =
    descartados > 0 && revertidos / descartados > TOPE_DE_REVERSIONES
      ? ` ALERTA: las asesoras revirtieron más del ${Math.round(TOPE_DE_REVERSIONES * 100)} % de los descartes automáticos; hay que endurecer las frases o apagar crm:etapa-automatica:descarte:<negocio>.`
      : "";

  return (
    `activa: lee cada mensaje del cliente y pasa a Frío (solo desde "---"), Caliente, Tibio${descarteApagado ? "" : " o Descartado"}` +
    `${descarteApagado ? " (descarte apagado: crm:etapa-automatica:descarte:<negocio> = off)" : ""}. ` +
    `Últimos ${DIAS_DE_MEDICION} días: ${porcentaje(conEtapa, total)} % de los leads nuevos con etapa (${conEtapa} de ${total}); ` +
    `movidos por frase: ${metodos.frase ?? 0}, por IA: ${metodos.ia ?? 0}; ` +
    `descartes automáticos: ${descartados}, revertidos por una asesora: ${revertidos} (${porcentaje(revertidos, descartados)} %).${alerta} ` +
    `La frase exacta del descarte queda en Contact.metadata.${CLAVE_DESCARTE_POR_LECTURA}.`
  );
}
