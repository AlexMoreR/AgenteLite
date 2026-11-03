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
/* MEDIR (para la herramienta "qué es esta aplicación" y para Dirección → Informe). */

const DIAS_DE_MEDICION = 7;
/** Si las asesoras revierten más que esto de los descartes automáticos, hay que endurecer la regla. */
const TOPE_DE_REVERSIONES = 0.05;
/** La meta del dueño: menos de este % de los chats de la semana sin etapa ("---"). */
export const META_SIN_ETAPA = 10;
const DIA_MS = 86_400_000;

export type CalientesDelDia = { fecha: string; calientes: number };

export type EstadoDeEtapaPorLectura = {
  /** La frase de siempre: activa o apagada y la medición de 7 días. */
  estado: string;
  /** Contactos que pasaron a Caliente hoy (hora de Colombia), contados desde HistorialEtapa. null si no se pudo leer. */
  calientes_hoy: number | null;
  /** Los 7 últimos días, del más viejo a hoy. Vacío si no se pudo leer. */
  calientes_por_dia: CalientesDelDia[];
  /** De los contactos de la línea de ventas con un mensaje del cliente en 7 días, el % que sigue en "---". */
  porcentaje_sin_etapa_semana: number | null;
  sin_etapa_semana: { sin_etapa: number; total: number } | null;
  barrido: {
    prendido: boolean | null;
    ganado_automatico_prendido: boolean | null;
    leidos_por_ia_hoy: number | null;
    ganados_de_gestion_hoy: number | null;
  };
  /** Las partes que fallaron (la consulta queda en el registro con su causa corta). */
  no_se_pudo_leer: string[];
};

type Db = typeof prisma;

/** El día en hora de Colombia (AAAA-MM-DD). Colombia no cambia de hora: siempre -05:00. */
function diaDeColombia(momento: Date | number): string {
  return new Date(new Date(momento).getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

function apagado(valor: string | null | undefined): boolean {
  return valor?.trim().toLowerCase() === "off";
}

/** Los 7 días (del más viejo a hoy) con los contactos que pasaron a Caliente cada día; uno por contacto y día. */
export function contarCalientesPorDia(
  filas: Array<{ contactId: string; creadoEn: Date }>,
  ahora: Date,
  dias = DIAS_DE_MEDICION,
): CalientesDelDia[] {
  const hoy = Date.parse(`${diaDeColombia(ahora)}T00:00:00-05:00`);
  const fechas = Array.from({ length: dias }, (_, i) => diaDeColombia(hoy - (dias - 1 - i) * DIA_MS + 12 * 3_600_000));
  const porDia = new Map(fechas.map((fecha) => [fecha, new Set<string>()]));
  for (const fila of filas) porDia.get(diaDeColombia(fila.creadoEn))?.add(fila.contactId);
  return fechas.map((fecha) => ({ fecha, calientes: porDia.get(fecha)?.size ?? 0 }));
}

/** El % con un decimal (1 de 10 → 10). Sin chats, 0. */
export function porcentajeSinEtapa(sinEtapa: number, total: number): number {
  return total > 0 ? Math.round((sinEtapa / total) * 1000) / 10 : 0;
}

/**
 * El estado de la etapa automática por lectura y del barrido, con los números del dueño: Calientes de hoy,
 * Calientes de los 7 días y el % de chats de la semana sin etapa. NUNCA lanza: si una consulta falla queda
 * en el registro con su causa corta, sale en `no_se_pudo_leer` y el resto sale igual.
 */
export async function estadoDeEtapaPorLectura(
  workspaceId: string,
  deps: { prisma?: Db; ahora?: Date } = {},
): Promise<EstadoDeEtapaPorLectura> {
  const db = deps.prisma ?? prisma;
  const ahora = deps.ahora ?? new Date();
  const no_se_pudo_leer: string[] = [];
  const seguro = async <T>(parte: string, leer: () => Promise<T>): Promise<T | null> => {
    try {
      return await leer();
    } catch (falla) {
      console.info(`[etapa-por-lectura] no se pudo leer ${parte} workspaceId=${workspaceId} causa=${causaCorta(falla)}`);
      no_se_pudo_leer.push(parte);
      return null;
    }
  };
  const bandera = async (clave: string) =>
    (await db.appSetting.findUnique({ where: { key: clave }, select: { value: true } }))?.value ?? null;

  const desde = new Date(ahora.getTime() - DIAS_DE_MEDICION * DIA_MS);
  const hoy = diaDeColombia(ahora);
  const medianocheDeHoy = new Date(`${hoy}T00:00:00-05:00`);
  const inicioDeLaSemana = new Date(medianocheDeHoy.getTime() - (DIAS_DE_MEDICION - 1) * DIA_MS);

  const [interruptores, estado, calientes, sinEtapa, leidosPorIA, ganadosDeGestion] = await Promise.all([
    seguro("interruptores", async () => {
      const [general, descarte, ganado] = await Promise.all([
        bandera(claveInterruptorEtapaAutomatica(workspaceId)),
        bandera(claveInterruptorDescarteAutomatico(workspaceId)),
        bandera(claveInterruptorGanadoAutomatico(workspaceId)),
      ]);
      return { general: !apagado(general), descarte: !apagado(descarte), ganado: !apagado(ganado) };
    }),
    seguro("medicion de 7 dias", () => medicionDeLaSemana(db, workspaceId, desde)),
    seguro("calientes por dia", async () => {
      const filas = await db.historialEtapa.findMany({
        where: { workspaceId, etapaNueva: "NEGOCIACION", NOT: { etapaAnterior: "NEGOCIACION" }, creadoEn: { gte: inicioDeLaSemana } },
        select: { contactId: true, creadoEn: true },
      });
      return contarCalientesPorDia(filas, ahora);
    }),
    seguro("chats sin etapa de la semana", async () => {
      // Los mismos chats que mira la IA del barrido: línea de ventas, dentro del CRM, con un mensaje del cliente en 7 días.
      const conMensaje = {
        workspaceId,
        excludedFromCrm: false,
        conversations: {
          some: {
            workspaceId,
            lastMessageAt: { gte: desde },
            channel: { purpose: "SALES" as const },
            messages: { some: { direction: "INBOUND" as const, isStatusBroadcast: false, createdAt: { gte: desde } } },
          },
        },
      };
      const [total, sin_etapa] = await Promise.all([
        db.contact.count({ where: conMensaje }),
        db.contact.count({ where: { ...conMensaje, crmStage: "NUEVO" } }),
      ]);
      return { sin_etapa, total };
    }),
    seguro("chats leidos por la IA hoy", async () => {
      const valor = JSON.parse((await bandera(claveContadorDeIA(workspaceId))) ?? "{}") as { dia?: string; usados?: number };
      return valor.dia === hoy && Number.isFinite(valor.usados) ? Number(valor.usados) : 0;
    }),
    seguro("Ganado de Gestion de hoy", () =>
      db.historialEtapa.count({
        where: {
          workspaceId,
          origen: "AUTOMATICO",
          etapaNueva: "GANADO",
          creadoEn: { gte: medianocheDeHoy },
          nota: { contains: "[gestion]" },
        },
      }),
    ),
  ]);

  let textoDelEstado: string;
  if (interruptores && !interruptores.general) {
    textoDelEstado = "apagada (crm:etapa-automatica:<negocio> = off): no lee los mensajes del cliente";
  } else {
    const descarteApagado = interruptores ? !interruptores.descarte : false;
    textoDelEstado =
      `activa: lee cada mensaje del cliente y pasa a Frío (solo desde "---"), Caliente, Tibio${descarteApagado ? "" : " o Descartado"}` +
      `${descarteApagado ? " (descarte apagado: crm:etapa-automatica:descarte:<negocio> = off)" : ""}. ` +
      (estado ?? "La medición de 7 días no se pudo leer. ") +
      `La frase exacta del descarte queda en Contact.metadata.${CLAVE_DESCARTE_POR_LECTURA}.`;
  }

  return {
    estado: textoDelEstado,
    calientes_hoy: calientes ? calientes[calientes.length - 1]?.calientes ?? 0 : null,
    calientes_por_dia: calientes ?? [],
    porcentaje_sin_etapa_semana: sinEtapa ? porcentajeSinEtapa(sinEtapa.sin_etapa, sinEtapa.total) : null,
    sin_etapa_semana: sinEtapa,
    barrido: {
      prendido: interruptores ? interruptores.general : null,
      ganado_automatico_prendido: interruptores ? interruptores.general && interruptores.ganado : null,
      leidos_por_ia_hoy: leidosPorIA,
      ganados_de_gestion_hoy: ganadosDeGestion,
    },
    no_se_pudo_leer,
  };
}

/** La medición de siempre (7 días): % de leads nuevos con etapa, movidos por frase y por IA, y descartes revertidos. */
async function medicionDeLaSemana(db: Db, workspaceId: string, desde: Date): Promise<string> {
  const prefijo = `${NOTA_ETAPA_AUTOMATICA}:%`;
  const [leads, porMetodo, reversiones] = await Promise.all([
    db.$queryRaw<Array<{ total: bigint; con_etapa: bigint }>>`
      SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE c."crmStage"::text <> 'NUEVO') AS con_etapa
      FROM "Contact" c
      WHERE c."workspaceId" = ${workspaceId} AND c."excludedFromCrm" = false AND c."createdAt" >= ${desde}
    `,
    db.$queryRaw<Array<{ metodo: string; cantidad: bigint }>>`
      SELECT CASE WHEN h."nota" LIKE '%[ia]' THEN 'ia' ELSE 'frase' END AS metodo, COUNT(*) AS cantidad
      FROM "HistorialEtapa" h
      WHERE h."workspaceId" = ${workspaceId} AND h."origen" = 'AUTOMATICO' AND h."creadoEn" >= ${desde}
        AND h."nota" LIKE ${prefijo} AND (h."nota" LIKE '%[ia]' OR h."nota" LIKE '%[frase]')
      GROUP BY 1
    `,
    db.$queryRaw<Array<{ descartados: bigint; revertidos: bigint }>>`
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
    `Últimos ${DIAS_DE_MEDICION} días: ${porcentaje(conEtapa, total)} % de los leads nuevos con etapa (${conEtapa} de ${total}); ` +
    `movidos por frase: ${metodos.frase ?? 0}, por IA: ${metodos.ia ?? 0}; ` +
    `descartes automáticos: ${descartados}, revertidos por una asesora: ${revertidos} (${porcentaje(revertidos, descartados)} %).${alerta} `
  );
}
