import { prisma } from "@/lib/prisma";

import {
  areaDeLaRuta,
  claveResponsableDeSistemas,
  ordenarAlertas,
  puedeVerAlerta,
  salePorWhatsApp,
  textoDeUrgente,
  tituloCorto,
  type AreaDeAlerta,
  type EstadoDeAlerta,
  type Prioridad,
  type QuienMira,
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
 * Quién mira la página. Sin responsable de Sistemas configurado: el jefe (dueño o administrador) ve las del negocio y
 * las suyas; cualquier otra persona, solo las suyas. Con responsable: el responsable ve las de Sistemas (sea jefe o no)
 * y el jefe, por defecto, las de Negocio (con `verTodas`, todas). Las personales de otra persona no las ve nadie más.
 */
export type Mirando = QuienMira;
const veNegocio = (mirando: Mirando) => mirando.esJefe || (!!mirando.responsableSistemasId && mirando.responsableSistemasId === mirando.userId);
const dondeMira = (mirando?: Mirando) =>
  mirando ? (veNegocio(mirando) ? { OR: [{ destinatarioId: null }, { destinatarioId: mirando.userId }] } : { destinatarioId: mirando.userId }) : {};
/** Con responsable configurado, qué alertas del negocio se ven se decide en código (no se guarda en la tabla). */
const filtraEnCodigo = (mirando?: Mirando) => !!mirando && !!mirando.responsableSistemasId;
const MAXIMO_A_LEER = 5000;

const AJUSTE_SIN_VALOR = new Set(["", "null"]);

/** El id del responsable de Sistemas (AppSetting); null si no hay o no se pudo leer (todo se ve como antes). */
export async function leerResponsableDeSistemas(workspaceId: string): Promise<string | null> {
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: claveResponsableDeSistemas(workspaceId) }, select: { value: true } });
    const valor = (fila?.value ?? "").trim();
    return AJUSTE_SIN_VALOR.has(valor) ? null : valor;
  } catch {
    return null;
  }
}

/** Guarda quién es el responsable de Sistemas (null = quitarlo). Quien llama ya validó permisos y que sea del equipo. */
export async function guardarResponsableDeSistemas(workspaceId: string, userId: string | null): Promise<void> {
  const key = claveResponsableDeSistemas(workspaceId);
  const value = userId ?? "";
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Las personas activas del equipo (para elegir al responsable de Sistemas). */
export async function listarEquipoParaResponsable(workspaceId: string): Promise<{ id: string; nombre: string }[]> {
  const miembros = await prisma.workspaceMember.findMany({
    where: { workspaceId, isActive: true },
    select: { userId: true, user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return miembros.map((m) => ({ id: m.userId, nombre: m.user?.name?.trim() || m.user?.email || m.userId }));
}

/**
 * Elige (o quita, con null) al responsable de Sistemas. Solo un jefe puede, y la persona tiene que ser un miembro activo
 * del negocio: así no se esconden alertas detrás de un id inventado.
 */
export async function elegirResponsableDeSistemas(workspaceId: string, esJefe: boolean, userId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!esJefe) return { ok: false, error: "Sin permiso." };
  if (userId !== null) {
    if (typeof userId !== "string" || !userId.trim()) return { ok: false, error: "Pedido inválido." };
    const miembro = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId, isActive: true }, select: { userId: true } });
    if (!miembro) return { ok: false, error: "Esa persona no es del equipo." };
  }
  await guardarResponsableDeSistemas(workspaceId, userId);
  return { ok: true };
}

/** Las alertas del negocio ya ordenadas (prioridad y, dentro, por la última vez que llegaron). Por defecto, sin las resueltas. */
export async function listarAlertas(workspaceId: string, filtro: FiltroDeAlertas = {}, limite = 300, mirando?: Mirando): Promise<AlertaGuardada[]> {
  const estado = filtro.estado ?? "ABIERTAS";
  const enCodigo = filtraEnCodigo(mirando);
  const filas = await prisma.alertaInterna.findMany({
    where: {
      workspaceId,
      ...dondeMira(mirando),
      ...(estado === "ABIERTAS" ? { estado: { in: ["NUEVA", "VISTA"] } } : estado === "TODAS" ? {} : { estado }),
      ...(filtro.prioridad ? { prioridad: filtro.prioridad } : {}),
    },
    orderBy: [{ ultimaVez: "desc" }, { creadoEn: "desc" }],
    // El límite se aplica DESPUÉS de filtrar por responsable: si no, una lista larga cortaría alertas que sí se ven.
    take: enCodigo ? MAXIMO_A_LEER : limite,
  });
  const visibles = enCodigo && mirando ? filas.filter((fila) => puedeVerAlerta(fila, mirando)) : filas;
  return ordenarAlertas(visibles.slice(0, limite));
}

/** Cuántas alertas hay por estado (para los contadores de la página): solo las que esa persona ve. */
export async function contarAlertas(workspaceId: string, mirando?: Mirando): Promise<Record<EstadoDeAlerta, number>> {
  const cuenta: Record<EstadoDeAlerta, number> = { NUEVA: 0, VISTA: 0, RESUELTA: 0 };
  if (filtraEnCodigo(mirando) && mirando) {
    const filas = await prisma.alertaInterna.findMany({
      where: { workspaceId, ...dondeMira(mirando) },
      select: { estado: true, origen: true, clave: true, destinatarioId: true },
      take: MAXIMO_A_LEER,
    });
    for (const fila of filas) if (fila.estado in cuenta && puedeVerAlerta(fila, mirando)) cuenta[fila.estado as EstadoDeAlerta] += 1;
    return cuenta;
  }
  const filas = await prisma.alertaInterna.groupBy({ by: ["estado"], where: { workspaceId, ...dondeMira(mirando) }, _count: { _all: true } });
  for (const fila of filas) if (fila.estado in cuenta) cuenta[fila.estado as EstadoDeAlerta] = fila._count._all;
  return cuenta;
}

/**
 * Marca una alerta como vista o resuelta. Siempre filtra por negocio (y, si se dice quién mira, por lo que esa persona ve): no se puede tocar la de otro. Una resuelta no
 * vuelve a "vista"; una vista conserva su primera hora.
 */
export async function marcarAlerta(workspaceId: string, id: string, nuevo: "VISTA" | "RESUELTA", ahora = new Date(), mirando?: Mirando): Promise<boolean> {
  const actual = await prisma.alertaInterna.findFirst({
    where: { id, workspaceId, ...dondeMira(mirando) },
    select: { estado: true, vistaEn: true, origen: true, clave: true, destinatarioId: true },
  });
  if (!actual) return false;
  if (filtraEnCodigo(mirando) && mirando && !puedeVerAlerta(actual, mirando)) return false;
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
