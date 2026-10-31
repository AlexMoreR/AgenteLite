import { prisma } from "@/lib/prisma";

import {
  alertaYaNoAplica,
  areaDeLaRuta,
  claveResponsableDeSistemas,
  idDeTarjetaDeLaClave,
  lineaDeCierre,
  lineaDeCierreDeLaLimpieza,
  lineaDeCierreDelBarrido,
  motivoCierraLaClave,
  ordenarAlertas,
  puedeVerAlerta,
  salePorWhatsApp,
  tarjetasYaNoEsperan,
  textoDeUrgente,
  tituloCorto,
  tituloEntreComillasDelAviso,
  type AreaDeAlerta,
  type EstadoDeAlerta,
  type MotivoDeCierre,
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

/** Las claves de alerta que hablan de una tarjeta (las que pueden llevar su id). */
const PREFIJOS_DE_TARJETA = ["auto:necesita:", "auto:trabado:", "auto:equipo:", "coord:necesita:"];

/**
 * Cierra solas las alertas abiertas de una tarjeta cuando el dueño la aprueba, responde la pregunta o la tarjeta se
 * cierra (HECHO, FALLIDO o borrada). Qué claves cierra cada motivo lo dice `motivoCierraLaClave`. Cada una queda
 * RESUELTA, con su hora y la línea "Resuelta sola: …" al final del detalle. Nunca lanza: una alerta no puede hacer
 * fallar la acción sobre la tarjeta. Devuelve cuántas cerró.
 */
export async function cerrarAlertasDeTarjeta(workspaceId: string, tarjetaId: string, motivo: MotivoDeCierre, ahora = new Date()): Promise<number> {
  try {
    const abiertas = await prisma.alertaInterna.findMany({
      where: {
        workspaceId,
        estado: { not: "RESUELTA" },
        OR: PREFIJOS_DE_TARJETA.map((prefijo) => ({ clave: { startsWith: `${prefijo}${tarjetaId}:` } })),
      },
      select: { id: true, clave: true, detalle: true },
    });
    const linea = lineaDeCierre(motivo, ahora);
    let cerradas = 0;
    for (const alerta of abiertas) {
      if (!motivoCierraLaClave(motivo, alerta.clave, tarjetaId)) continue;
      // Condicionada a que siga abierta: si alguien la resolvió un instante antes, no se le pisa la hora.
      cerradas += await cerrarConLinea(alerta, linea, ahora);
    }
    return cerradas;
  } catch (error) {
    console.warn("[alertas] no se pudieron cerrar las alertas de la tarjeta", { tarjetaId, motivo, error: error instanceof Error ? error.message : String(error) });
    return 0;
  }
}

/** Cierra una alerta abierta con la línea al final del detalle. Condicionada a que siga abierta (no pisa una resuelta a mano). */
async function cerrarConLinea(alerta: { id: string; detalle: string | null }, linea: string, ahora: Date): Promise<number> {
  const detalle = alerta.detalle?.trim() ? `${alerta.detalle.trim()}\n\n${linea}` : linea;
  const hecho = await prisma.alertaInterna.updateMany({ where: { id: alerta.id, estado: { not: "RESUELTA" } }, data: { estado: "RESUELTA", resueltaEn: ahora, detalle } });
  return hecho.count;
}

/**
 * BARRIDO de cada minuto (lo llama el reloj de los avisos al dueño): las alertas abiertas de una tarjeta que ya avanzó o se
 * cerró quedan RESUELTAS con "Resuelta sola: la tarjeta ya avanzó o se cerró (…)". Qué cuenta como "ya no aplica" lo dice
 * `alertaYaNoAplica`. Las tarjetas se leen en UNA consulta, borradas incluidas. Nunca lanza; devuelve cuántas cerró.
 */
export async function barrerAlertasDeTarjetas(workspaceId: string, ahora = new Date()): Promise<number> {
  try {
    const abiertas = await prisma.alertaInterna.findMany({
      where: { workspaceId, estado: { not: "RESUELTA" }, OR: PREFIJOS_DE_TARJETA.map((prefijo) => ({ clave: { startsWith: prefijo } })) },
      select: { id: true, clave: true, detalle: true },
    });
    const conTarjeta = abiertas.map((alerta) => ({ alerta, tarjetaId: idDeTarjetaDeLaClave(alerta.clave) })).filter((x): x is { alerta: (typeof abiertas)[number]; tarjetaId: string } => !!x.tarjetaId);
    if (!conTarjeta.length) return 0;
    const tarjetas = await prisma.tarjetaTablero.findMany({
      where: { id: { in: [...new Set(conTarjeta.map((x) => x.tarjetaId))] }, tablero: { workspaceId } },
      select: { id: true, estado: true, borradoEn: true },
    });
    const porId = new Map(tarjetas.map((t) => [t.id, t]));
    const linea = lineaDeCierreDelBarrido(ahora);
    let cerradas = 0;
    for (const { alerta, tarjetaId } of conTarjeta) {
      if (!alertaYaNoAplica(alerta.clave, porId.get(tarjetaId) ?? null)) continue;
      cerradas += await cerrarConLinea(alerta, linea, ahora);
    }
    return cerradas;
  } catch (error) {
    console.warn("[alertas] no se pudo barrer las alertas de tarjetas", { workspaceId, error: error instanceof Error ? error.message : String(error) });
    return 0;
  }
}

/** La marca de la limpieza única de los avisos viejos del Coordinador: con la fila, no vuelve a correr. */
export const claveLimpiezaDelCoordinador = (workspaceId: string) => `alertas:limpieza-coordinador-v1:${workspaceId}`;

const PREFIJO_COORD_NECESITA = "coord:necesita:";

/**
 * LIMPIEZA ÚNICA (30-oct-2026) de los avisos viejos del Coordinador `coord:necesita:<texto>` (de antes de que llevaran el id
 * de la tarjeta). De cada uno saca el título (`para "Título"` o `«Título»`) y busca las tarjetas del negocio con ese título
 * exacto, borradas incluidas. La cierra SOLO si hay al menos una y ninguna espera (`tarjetasYaNoEsperan`); sin título, sin
 * tarjetas o con duda, la deja abierta. Al terminar guarda la marca en AppSetting y deja en el registro cuántas cerró y
 * cuántas dejó. Si no pudo leer las alertas no guarda la marca (lo intenta en la siguiente vuelta). Nunca lanza.
 */
export async function limpiezaUnicaDelCoordinador(workspaceId: string, ahora = new Date()): Promise<{ hecha: boolean; cerradas: number; dejadas: number }> {
  const key = claveLimpiezaDelCoordinador(workspaceId);
  try {
    if (await prisma.appSetting.findUnique({ where: { key }, select: { value: true } })) return { hecha: false, cerradas: 0, dejadas: 0 };
    const abiertas = await prisma.alertaInterna.findMany({
      where: { workspaceId, estado: { not: "RESUELTA" }, clave: { startsWith: PREFIJO_COORD_NECESITA } },
      select: { id: true, clave: true, detalle: true },
    });
    let cerradas = 0;
    let dejadas = 0;
    for (const alerta of abiertas) {
      // Las nuevas (con id) las cuida el barrido; acá solo las viejas.
      if (idDeTarjetaDeLaClave(alerta.clave)) continue;
      try {
        const titulo = tituloEntreComillasDelAviso(alerta.clave.slice(PREFIJO_COORD_NECESITA.length));
        const tarjetas = titulo
          ? await prisma.tarjetaTablero.findMany({ where: { titulo, tablero: { workspaceId } }, select: { estado: true, borradoEn: true } })
          : [];
        if (titulo && tarjetasYaNoEsperan(tarjetas)) cerradas += await cerrarConLinea(alerta, lineaDeCierreDeLaLimpieza(titulo, ahora), ahora);
        else dejadas += 1;
      } catch (error) {
        dejadas += 1;
        console.warn("[alertas] limpieza única: no se pudo revisar una alerta", { id: alerta.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const value = JSON.stringify({ cuando: ahora.toISOString(), cerradas, dejadas });
    await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    console.info("[alertas] limpieza única del Coordinador", { workspaceId, cerradas, dejadas });
    return { hecha: true, cerradas, dejadas };
  } catch (error) {
    console.warn("[alertas] no se pudo hacer la limpieza única del Coordinador", { workspaceId, error: error instanceof Error ? error.message : String(error) });
    return { hecha: false, cerradas: 0, dejadas: 0 };
  }
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
