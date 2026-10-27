import { prisma } from "@/lib/prisma";

import {
  ordenarAlertas,
  salePorWhatsApp,
  textoDeUrgente,
  tituloCorto,
  type EstadoDeAlerta,
  type Prioridad,
} from "../dominio/reglas";

/**
 * ALERTAS INTERNAS (servicio). Un solo punto de entrada, `registrarAlerta`, con estas reglas:
 *  1. Toda alerta se guarda SIEMPRE en la página (guardar va primero: si el WhatsApp falla, la alerta queda).
 *  2. Solo las URGENTES salen por WhatsApp, con un mensaje de 2 líneas y el link a la página.
 *  3. Las demás no salen: se revisan en /cliente/alertas.
 *  4. La misma clave mientras sigue abierta (NUEVA o VISTA) no se duplica: se refresca y sube `veces`.
 *
 * Interruptor: AppSetting `alertas:solo-urgentes:<workspaceId>`; sin fila empieza PRENDIDO. Apagado, cada fuente
 * vuelve a avisar como antes (la alerta igual se guarda en la página).
 *
 * Nunca lanza: una alerta que no se puede guardar no puede tumbar el chequeo que la generó.
 */

export const claveInterruptorSoloUrgentes = (workspaceId: string) => `alertas:solo-urgentes:${workspaceId}`;

export async function soloUrgentesPrendido(workspaceId: string): Promise<boolean> {
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: claveInterruptorSoloUrgentes(workspaceId) }, select: { value: true } });
    return fila?.value !== "false" && !/"activo"\s*:\s*false/.test(fila?.value ?? "");
  } catch {
    return true;
  }
}

export type AlertaGuardada = {
  id: string;
  clave: string;
  prioridad: string;
  titulo: string;
  detalle: string | null;
  origen: string;
  estado: string;
  salioPorWhatsApp: boolean;
  veces: number;
  creadoEn: Date;
  vistaEn: Date | null;
  resueltaEn: Date | null;
};

export type PedidoDeAlerta = {
  workspaceId: string;
  clave: string;
  prioridad: Prioridad;
  titulo: string;
  detalle?: string | null;
  origen: string;
  /** false = si la alerta ya está abierta no se toca (para quien la registra en cada vuelta del reloj). Por defecto true. */
  refrescar?: boolean;
  /**
   * Cómo sale el WhatsApp de una URGENTE (cada fuente tiene su destinatario y sus reglas de silencio). Recibe el texto
   * corto ya armado y dice si salió. Sin esto, o con otra prioridad, no sale nada.
   */
  enviar?: (texto: string) => Promise<boolean>;
};

export type ResultadoDeAlerta = { id: string | null; creada: boolean; salioPorWhatsApp: boolean };

/** Guarda (o refresca) la alerta y, si es urgente y la fuente dio cómo, manda el aviso corto. */
export async function registrarAlerta(pedido: PedidoDeAlerta): Promise<ResultadoDeAlerta> {
  const titulo = tituloCorto(pedido.titulo, 200) || "Alerta sin título";
  const detalle = pedido.detalle?.trim() ? pedido.detalle.trim().slice(0, 8000) : null;
  let id: string | null = null;
  let creada = false;
  try {
    const abierta = await prisma.alertaInterna.findFirst({
      where: { workspaceId: pedido.workspaceId, clave: pedido.clave, estado: { in: ["NUEVA", "VISTA"] } },
      orderBy: { creadoEn: "desc" },
      select: { id: true },
    });
    if (abierta && pedido.refrescar === false) {
      id = abierta.id;
    } else if (abierta) {
      // La misma alerta sigue abierta: se refresca (no se duplica). Si subió de prioridad, la prioridad nueva manda.
      await prisma.alertaInterna.update({
        where: { id: abierta.id },
        data: { prioridad: pedido.prioridad, titulo, detalle, veces: { increment: 1 } },
      });
      id = abierta.id;
    } else {
      const fila = await prisma.alertaInterna.create({
        data: { workspaceId: pedido.workspaceId, clave: pedido.clave, prioridad: pedido.prioridad, titulo, detalle, origen: pedido.origen },
        select: { id: true },
      });
      id = fila.id;
      creada = true;
    }
  } catch (error) {
    console.warn("[alertas] no se pudo guardar la alerta", error instanceof Error ? error.message : String(error));
  }

  let salio = false;
  if (salePorWhatsApp(pedido.prioridad) && pedido.enviar) {
    try {
      salio = await pedido.enviar(textoDeUrgente(titulo));
    } catch (error) {
      console.warn("[alertas] no salió el WhatsApp de la urgente", error instanceof Error ? error.message : String(error));
    }
    if (salio && id) await marcarSalioPorWhatsApp(pedido.workspaceId, pedido.clave);
  }
  return { id, creada, salioPorWhatsApp: salio };
}

/** Anota que el WhatsApp de una alerta abierta ya salió (cuando la fuente lo manda aparte de `registrarAlerta`). */
export async function marcarSalioPorWhatsApp(workspaceId: string, clave: string): Promise<void> {
  try {
    await prisma.alertaInterna.updateMany({ where: { workspaceId, clave, estado: { in: ["NUEVA", "VISTA"] } }, data: { salioPorWhatsApp: true } });
  } catch {
    // es solo la marca de la página: el WhatsApp ya salió
  }
}

export type FiltroDeAlertas = { estado?: EstadoDeAlerta | "ABIERTAS" | "TODAS"; prioridad?: Prioridad | null };

/** Las alertas del negocio ya ordenadas (prioridad y, dentro, de la más nueva a la más vieja). Por defecto, sin las resueltas. */
export async function listarAlertas(workspaceId: string, filtro: FiltroDeAlertas = {}, limite = 300): Promise<AlertaGuardada[]> {
  const estado = filtro.estado ?? "ABIERTAS";
  const filas = await prisma.alertaInterna.findMany({
    where: {
      workspaceId,
      ...(estado === "ABIERTAS" ? { estado: { in: ["NUEVA", "VISTA"] } } : estado === "TODAS" ? {} : { estado }),
      ...(filtro.prioridad ? { prioridad: filtro.prioridad } : {}),
    },
    orderBy: { creadoEn: "desc" },
    take: limite,
  });
  return ordenarAlertas(filas);
}

/** Cuántas alertas hay por estado (para los contadores de la página). */
export async function contarAlertas(workspaceId: string): Promise<Record<EstadoDeAlerta, number>> {
  const filas = await prisma.alertaInterna.groupBy({ by: ["estado"], where: { workspaceId }, _count: { _all: true } });
  const cuenta: Record<EstadoDeAlerta, number> = { NUEVA: 0, VISTA: 0, RESUELTA: 0 };
  for (const fila of filas) if (fila.estado in cuenta) cuenta[fila.estado as EstadoDeAlerta] = fila._count._all;
  return cuenta;
}

/**
 * Marca una alerta como vista o resuelta. Siempre filtra por negocio: no se puede tocar la de otro. Una resuelta no
 * vuelve a "vista"; una vista conserva su primera hora.
 */
export async function marcarAlerta(workspaceId: string, id: string, nuevo: "VISTA" | "RESUELTA", ahora = new Date()): Promise<boolean> {
  const actual = await prisma.alertaInterna.findFirst({ where: { id, workspaceId }, select: { estado: true, vistaEn: true } });
  if (!actual) return false;
  if (nuevo === "VISTA" && actual.estado !== "NUEVA") return true;
  await prisma.alertaInterna.update({
    where: { id },
    data: nuevo === "VISTA" ? { estado: "VISTA", vistaEn: ahora } : { estado: "RESUELTA", resueltaEn: ahora, vistaEn: actual.vistaEn ?? ahora },
  });
  return true;
}
