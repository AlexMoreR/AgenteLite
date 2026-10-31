import { prisma } from "@/lib/prisma";
import {
  CLAVE_DESCARTE_POR_LECTURA,
  NOTA_ETAPA_AUTOMATICA,
  causaCorta,
  claveInterruptorDescarteAutomatico,
  claveInterruptorEtapaAutomatica,
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
  type LecturaDelMensaje,
} from "@/features/crm/domain/intencion-del-cliente";
import type { CrmStage } from "@/features/crm/types";

/**
 * LA ETAPA POR LO QUE DICE EL CLIENTE (decisión del dueño, 23-oct-2026).
 *
 * Corre después de cada mensaje del cliente, en segundo plano (after() del webhook): no demora nada y
 * nunca lanza. Primero frases claras (gratis); si no hay ninguna, una pregunta corta a la IA del CRM,
 * que solo puede decir Caliente, Tibio o nada. Descartado sale SOLO de una frase clara.
 *
 * Mueve la etapa con el motor de la etapa automática (src/lib/etapa-automatica-crm.ts), con todas sus
 * protecciones: nunca baja salvo a Descartado, no toca Ganado ni Perdido, ni "fuera del CRM", ni la
 * línea administrativa, y respeta 24 horas lo que una persona movió a mano. No le escribe al cliente:
 * solo pone la etapa, la nota en el chat y la fecha de recontacto.
 */

/** El modelo barato que ya usa el CRM para leer conversaciones. */
const MODELO = "gpt-4.1-mini";
const ESPERA_IA_MS = 8_000;

const SISTEMA = `Eres el clasificador del CRM de una tienda de mobiliario para estética (camillas, sillas, combos) en Colombia.
Lees UN mensaje de un cliente por WhatsApp y contestas con UNA palabra:
CALIENTE si quiere comprar ya: pregunta cómo pagar, pide datos para consignar, pide el total, elige color o modelo, dice su ciudad para el envío o manda sus datos.
TIBIO si muestra interés pero lo deja para después, duda o lo va a pensar.
NADA si solo saluda, pregunta información general, precio o fotos, o no se sabe.
Nunca contestes otra cosa.`;

async function preguntarALaIA(texto: string): Promise<"CALIENTE" | "TIBIO" | null> {
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

/** La IA solo sube a Caliente o Tibio: a un Caliente no se le pregunta. */
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
      // Solo si el chat se puede mover: ni línea Admin, ni "fuera del CRM", ni cerrado, ni movido a mano
      // en las últimas 24 h. Así esos mensajes no salen a la IA ni gastan.
      const etapa = await etapaQueSePuedeLeer(input);
      if (etapa && !SIN_IA.includes(etapa)) {
        // Si la IA no contesta (sin conexión, demora), no se mueve nada: lo intenta el próximo mensaje.
        const ia = await preguntarALaIA(texto).catch((falla) => {
          console.info(`[etapa-por-lectura] la IA no contestó conversationId=${input.conversationId} causa=${causaCorta(falla)}`);
          return null;
        });
        if (ia) {
          metodo = "ia";
          lectura = {
            intencion: ia,
            porque: ia === "CALIENTE" ? "el cliente mostró intención de compra" : "el cliente lo deja para después",
          };
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
    } else {
      movida = await moverEtapaAutomatica({ ...base, destino: "NEGOCIACION" });
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

export async function estadoDeEtapaPorLectura(workspaceId: string): Promise<string> {
  const [general, descarte] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: claveInterruptorEtapaAutomatica(workspaceId) }, select: { value: true } }),
    prisma.appSetting.findUnique({ where: { key: claveInterruptorDescarteAutomatico(workspaceId) }, select: { value: true } }),
  ]);
  if (general?.value?.trim().toLowerCase() === "off") {
    return "apagada (crm:etapa-automatica:<negocio> = off): no lee los mensajes del cliente";
  }
  const desde = new Date(Date.now() - DIAS_DE_MEDICION * 86_400_000);
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
  const descarteApagado = descarte?.value?.trim().toLowerCase() === "off";

  return (
    `activa: lee cada mensaje del cliente y pasa a Caliente, Tibio${descarteApagado ? "" : " o Descartado"}` +
    `${descarteApagado ? " (descarte apagado: crm:etapa-automatica:descarte:<negocio> = off)" : ""}. ` +
    `Últimos ${DIAS_DE_MEDICION} días: ${porcentaje(conEtapa, total)} % de los leads nuevos con etapa (${conEtapa} de ${total}); ` +
    `movidos por frase: ${metodos.frase ?? 0}, por IA: ${metodos.ia ?? 0}; ` +
    `descartes automáticos: ${descartados}, revertidos por una asesora: ${revertidos} (${porcentaje(revertidos, descartados)} %).${alerta} ` +
    `La frase exacta del descarte queda en Contact.metadata.${CLAVE_DESCARTE_POR_LECTURA}.`
  );
}
