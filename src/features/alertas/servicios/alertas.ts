import { prisma } from "@/lib/prisma";

import {
  areaDeLaRuta,
  ordenarAlertas,
  salePorWhatsApp,
  textoDeUrgente,
  tituloCorto,
  type AreaDeAlerta,
  type EstadoDeAlerta,
  type Prioridad,
} from "../dominio/reglas";

/**
 * ALERTAS INTERNAS (servicio). Un solo punto de entrada, `registrarAlerta`, con estas reglas:
 *  1. Toda alerta se guarda SIEMPRE en la página (guardar va primero: si el WhatsApp falla, la alerta queda).
 *  2. Solo las URGENTES salen por WhatsApp, con un mensaje de 2 líneas y el link a la página.
 *  3. Las demás no salen: se revisan en /cliente/alertas.
 *  4. La misma clave mientras sigue abierta (NUEVA o VISTA) no se duplica: se refresca, sube `veces` y `ultimaVez` pasa a la hora
 *     de esta repetición (así queda arriba en la página).
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
  /** La última vez que llegó (sube al repetirse). */
  ultimaVez: Date;
  vistaEn: Date | null;
  resueltaEn: Date | null;
  destinatarioId: string | null;
};

export type PedidoDeAlerta = {
  workspaceId: string;
  clave: string;
  prioridad: Prioridad;
  titulo: string;
  detalle?: string | null;
  origen: string;
  /** De quién es: una persona del equipo (solo ella la ve). Sin esto es del negocio (dueño y administradores). */
  destinatarioId?: string | null;
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
      where: { workspaceId: pedido.workspaceId, clave: pedido.clave, destinatarioId: pedido.destinatarioId ?? null, estado: { in: ["NUEVA", "VISTA"] } },
      orderBy: { creadoEn: "desc" },
      select: { id: true },
    });
    if (abierta && pedido.refrescar === false) {
      id = abierta.id;
    } else if (abierta) {
      // La misma alerta sigue abierta: se refresca (no se duplica). Si subió de prioridad, la prioridad nueva manda.
      await prisma.alertaInterna.update({
        where: { id: abierta.id },
        // Y sube en la lista: `ultimaVez` es la hora de esta repetición (creadoEn sigue siendo la primera).
        data: { prioridad: pedido.prioridad, titulo, detalle, veces: { increment: 1 }, ultimaVez: new Date() },
      });
      id = abierta.id;
    } else {
      const fila = await prisma.alertaInterna.create({
        data: { workspaceId: pedido.workspaceId, clave: pedido.clave, prioridad: pedido.prioridad, titulo, detalle, origen: pedido.origen, destinatarioId: pedido.destinatarioId ?? null },
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

/**
 * Quién mira la página: el jefe (dueño o administrador) ve las del negocio y las suyas; cualquier otra persona, solo
 * las suyas. Las personales de otra persona no las ve nadie más.
 */
export type Mirando = { userId: string; esJefe: boolean };
const dondeMira = (mirando?: Mirando) =>
  mirando ? (mirando.esJefe ? { OR: [{ destinatarioId: null }, { destinatarioId: mirando.userId }] } : { destinatarioId: mirando.userId }) : {};

/** Las alertas del negocio ya ordenadas (prioridad y, dentro, por la última vez que llegaron). Por defecto, sin las resueltas. */
export async function listarAlertas(workspaceId: string, filtro: FiltroDeAlertas = {}, limite = 300, mirando?: Mirando): Promise<AlertaGuardada[]> {
  const estado = filtro.estado ?? "ABIERTAS";
  const filas = await prisma.alertaInterna.findMany({
    where: {
      workspaceId,
      ...dondeMira(mirando),
      ...(estado === "ABIERTAS" ? { estado: { in: ["NUEVA", "VISTA"] } } : estado === "TODAS" ? {} : { estado }),
      ...(filtro.prioridad ? { prioridad: filtro.prioridad } : {}),
    },
    orderBy: [{ ultimaVez: "desc" }, { creadoEn: "desc" }],
    take: limite,
  });
  return ordenarAlertas(filas);
}

/** Cuántas alertas hay por estado (para los contadores de la página). */
export async function contarAlertas(workspaceId: string, mirando?: Mirando): Promise<Record<EstadoDeAlerta, number>> {
  const filas = await prisma.alertaInterna.groupBy({ by: ["estado"], where: { workspaceId, ...dondeMira(mirando) }, _count: { _all: true } });
  const cuenta: Record<EstadoDeAlerta, number> = { NUEVA: 0, VISTA: 0, RESUELTA: 0 };
  for (const fila of filas) if (fila.estado in cuenta) cuenta[fila.estado as EstadoDeAlerta] = fila._count._all;
  return cuenta;
}

/**
 * Marca una alerta como vista o resuelta. Siempre filtra por negocio (y, si se dice quién mira, por lo que esa persona ve): no se puede tocar la de otro. Una resuelta no
 * vuelve a "vista"; una vista conserva su primera hora.
 */
export async function marcarAlerta(workspaceId: string, id: string, nuevo: "VISTA" | "RESUELTA", ahora = new Date(), mirando?: Mirando): Promise<boolean> {
  const actual = await prisma.alertaInterna.findFirst({ where: { id, workspaceId, ...dondeMira(mirando) }, select: { estado: true, vistaEn: true } });
  if (!actual) return false;
  if (nuevo === "VISTA" && actual.estado !== "NUEVA") return true;
  await prisma.alertaInterna.update({
    where: { id },
    data: nuevo === "VISTA" ? { estado: "VISTA", vistaEn: ahora } : { estado: "RESUELTA", resueltaEn: ahora, vistaEn: actual.vistaEn ?? ahora },
  });
  return true;
}

/**
 * SOLO LECTURA. El área de cada tarjeta del tablero (por su id) para la etiqueta y el filtro de la página: sube por las
 * madres juntando las carpetas "Área" (tipo sin estados) y deja que `areaDeLaRuta` elija (dentro de Tecnología, la
 * subárea madre). Tarjeta borrada, sin área o fuera de la lista fija = null (la página la manda a "General").
 */
export async function leerAreasDeTarjetas(workspaceId: string, ids: readonly string[]): Promise<Map<string, AreaDeAlerta | null>> {
  const resultado = new Map<string, AreaDeAlerta | null>();
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return resultado;
  type Nodo = { id: string; titulo: string; padreId: string | null; borradoEn: Date | null; area: string | null; usaEstados: boolean };
  const nodos = new Map<string, Nodo>();
  let pendientes = unicos;
  // Máximo 8 niveles hacia arriba: una cadena de madres con vuelta no puede colgar la página.
  for (let nivel = 0; nivel < 8 && pendientes.length > 0; nivel += 1) {
    const filas = await prisma.tarjetaTablero.findMany({
      where: { id: { in: pendientes }, tablero: { workspaceId } },
      select: { id: true, titulo: true, padreId: true, borradoEn: true, area: true, tipo: { select: { usaEstados: true } } },
    });
    for (const fila of filas) nodos.set(fila.id, { id: fila.id, titulo: fila.titulo, padreId: fila.padreId, borradoEn: fila.borradoEn, area: fila.area, usaEstados: fila.tipo.usaEstados });
    pendientes = [...new Set(filas.map((fila) => fila.padreId).filter((id): id is string => !!id && !nodos.has(id)))];
  }
  for (const id of unicos) {
    const tarjeta = nodos.get(id);
    if (!tarjeta || tarjeta.borradoEn) {
      resultado.set(id, null);
      continue;
    }
    const ruta: string[] = [];
    const vistos = new Set<string>();
    for (let actual: Nodo | undefined = tarjeta; actual && !vistos.has(actual.id); actual = actual.padreId ? nodos.get(actual.padreId) : undefined) {
      vistos.add(actual.id);
      if (!actual.usaEstados) ruta.unshift(actual.titulo);
    }
    resultado.set(id, areaDeLaRuta(ruta) ?? areaDeLaRuta(tarjeta.area ? [tarjeta.area] : []));
  }
  return resultado;
}
