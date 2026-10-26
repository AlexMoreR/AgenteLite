import { leerConfigGravedad, lineaInterna } from "@/features/avisos-gravedad/servicios/enrutador";
import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";

import {
  MOTIVO_INTERRUPTOR_APAGADO,
  MOTIVO_NO_ES_DEL_EQUIPO,
  MOTIVO_SIN_LINEA,
  MOTIVO_YA_SE_MANDO,
  estaEnElEquipo,
  hoyEnBogota,
  type Area,
  type EstadoDeEnvio,
  type PedidoDeEnvio,
} from "../dominio/reglas";
import { agenteActivo, leerEquipoDeAvisos } from "./config";

/**
 * EL WHATSAPP INTERNO DEL AGENTE DE ÁREA.
 *
 * Todo se valida AQUÍ, en el servidor, y no en el agente:
 *  1. El número tiene que estar en la lista del equipo (Mi empresa → Equipo). Un cliente nunca.
 *  2. El interruptor del agente tiene que estar prendido.
 *  3. Sale por la línea INTERNA (Admin), la misma de los avisos del Supervisor; nunca una de ventas.
 *  4. Un solo envío vivo por número, área y día: lo garantiza un índice único parcial en la base.
 *
 * Cada intento queda anotado (a quién, qué texto y si salió o por qué no). Nunca lanza.
 */

export type ResultadoDeEnvio = {
  ok: boolean;
  estado: EstadoDeEnvio;
  motivo: string | null;
  envioId: string | null;
};

function esChoqueDeUnico(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

async function anotar(
  base: { workspaceId: string; area: Area; fecha: string; pedido: PedidoDeEnvio },
  estado: EstadoDeEnvio,
  motivo: string | null,
): Promise<string | null> {
  try {
    const fila = await prisma.agenteDeAreaEnvio.create({
      data: {
        workspaceId: base.workspaceId,
        area: base.area,
        fecha: base.fecha,
        tipo: base.pedido.tipo,
        numero: base.pedido.numero,
        destinatario: base.pedido.destinatario,
        texto: base.pedido.texto,
        estado,
        motivo,
      },
      select: { id: true },
    });
    return fila.id;
  } catch (error) {
    if (esChoqueDeUnico(error)) throw error;
    console.warn("[agentes-de-area] no se pudo anotar el envío", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function mandarWhatsAppAlEquipo(input: {
  workspaceId: string;
  area: Area;
  pedido: PedidoDeEnvio;
  ahora?: Date;
}): Promise<ResultadoDeEnvio> {
  const { workspaceId, area, pedido } = input;
  const fecha = hoyEnBogota(input.ahora);
  const base = { workspaceId, area, fecha, pedido };
  const bloquear = async (motivo: string): Promise<ResultadoDeEnvio> => {
    const envioId = await anotar(base, "BLOQUEADO", motivo).catch(() => null);
    return { ok: false, estado: "BLOQUEADO", motivo, envioId };
  };

  // 1. Solo gente del equipo. Esto va primero: un cliente se rechaza pase lo que pase.
  const equipo = await leerEquipoDeAvisos(workspaceId);
  if (!estaEnElEquipo(pedido.numero, equipo.map((persona) => persona.numero))) return bloquear(MOTIVO_NO_ES_DEL_EQUIPO);

  // 2. El interruptor.
  if (!(await agenteActivo(area, workspaceId))) return bloquear(MOTIVO_INTERRUPTOR_APAGADO);

  // 3. La línea interna (Admin), nunca una de ventas.
  const config = await leerConfigGravedad(workspaceId);
  const linea = await lineaInterna(workspaceId, config).catch(() => null);
  if (!linea) return bloquear(MOTIVO_SIN_LINEA);
  const canal = await prisma.whatsAppChannel
    .findFirst({ where: { id: linea.canalId, workspaceId }, select: { purpose: true } })
    .catch(() => null);
  if (!canal || canal.purpose === "SALES") return bloquear("la línea interna no es una línea de equipo: no se mandó");

  // 4. Un solo envío vivo por número y día: se reserva antes de mandar.
  let envioId: string | null;
  try {
    envioId = await anotar(base, "PENDIENTE", null);
  } catch (error) {
    if (esChoqueDeUnico(error)) return bloquear(MOTIVO_YA_SE_MANDO);
    throw error;
  }
  // Sin la reserva no hay garantía de "una sola vez": mejor no mandar.
  if (!envioId) return { ok: false, estado: "FALLIDO", motivo: "no se pudo reservar el envío: no se mandó", envioId: null };

  try {
    await sendEvolutionTextMessageWithReconnect({ instanceName: linea.instancia, phoneNumber: pedido.numero, text: pedido.texto });
  } catch (error) {
    const motivo = `no salió: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300);
    if (envioId) await prisma.agenteDeAreaEnvio.update({ where: { id: envioId }, data: { estado: "FALLIDO", motivo } }).catch(() => {});
    return { ok: false, estado: "FALLIDO", motivo, envioId };
  }
  if (envioId) await prisma.agenteDeAreaEnvio.update({ where: { id: envioId }, data: { estado: "ENVIADO", motivo: null } }).catch(() => {});
  return { ok: true, estado: "ENVIADO", motivo: null, envioId };
}
