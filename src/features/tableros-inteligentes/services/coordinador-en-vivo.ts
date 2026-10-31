import { prisma } from "@/lib/prisma";

import {
  type CargaDelLatido,
  type EtapaVisible,
  type HoyVista,
  type LatidoGuardado,
  type Lugar,
  type Modelo,
  type EstadoDelUsoDeClaude,
  type PausaUsoDelLatido,
  type Semaforo,
  type UsoDelLatido,
  type PasosVista,
  type RevisionDelLatido,
  type RevisorVisible,
  type EstadoDelRevisor,
  REVISORES_VISIBLES,
  NOMBRE_DEL_REVISOR,
  pasoDelError,
  pasosDeLaTarjeta,
  armarHoy,
  etapaDelEstado,
  estaApagado,
  haceTexto,
  duracionTexto,
  latidoDeEntrada,
  latidoGuardado,
  NOMBRE_DE_LA_ETAPA,
  NOMBRE_DEL_LUGAR,
  NOMBRE_DEL_MODELO,
  enQueVa,
  rangoDeHoyEnBogota,
  semaforoDeLaCarga,
  textoDelUso,
  textoDelUsoDeClaude,
} from "./reglas-coordinador-en-vivo";
import {
  NOMBRE_DE_LA_ZONA,
  esZona,
  etiquetaEsperando,
  prioridadDeLaFila,
  recogidaDelResultado,
  zonasQueEsperanLaPantalla,
} from "./reglas-trabajador";
import { diaDeBogota } from "./archivadas";
import { leerPausaPorUso } from "./pausa-por-uso-de-claude";
import { ErrorDelTrabajador, type ContextoTrabajador } from "./trabajador";
import { linkDeLaTarjeta } from "./tableros";

/*
  EL PANEL "COORDINADOR EN VIVO" (24-oct-2026): lo que el dueño ve para saber cómo trabaja el Coordinador.
  Solo lectura: no toca chats, el bot, Meta Ads ni el libro V3.

  - guardarLatido (POST /api/trabajador/latido): el Coordinador manda su estado cada 15 s con su clave. Se
    guarda SOLO el último, como un ajuste del negocio (AppSetting `trabajador:latido:<negocio>:<clave>`):
    sin tabla nueva y sin nada que borrar a las 24 h.
  - Máximos del día (31-oct-2026): con los `corriendo`, `enFila` y `cupos` del latido se guarda, por día de Bogotá, el
    máximo de "corriendo a la vez" y el de "en fila" (AppSetting `trabajador:cupos-del-dia:<negocio>`). Los lee el resumen
    de las 9 p. m. Solo se escribe cuando sube un máximo o cambian los cupos.
  - vistaDelCoordinador (GET /api/cliente/tableros-inteligentes/coordinador y la herramienta MCP
    ver_coordinador): junta el último latido con las tarjetas en marcha, la fila y lo de hoy.

  "Apagado" se calcula con la hora en que el CRM RECIBIÓ el latido, no con la del PC. Las tarjetas (qué está
  en marcha, la fila, lo de hoy) salen de la base, así que se ven aunque el Coordinador esté apagado.
*/

const PREFIJO = "trabajador:latido:";
const HOST_DEL_CRM = new URL(linkDeLaTarjeta("x")).hostname;
const HORAS_ATRAS_PARA_EL_INICIO = 12;
const MAXIMO_DE_FILA = 15;
const MAXIMO_DE_TRABAJOS_DE_HOY = 30;

export const claveDelLatido = (workspaceId: string, claveId: string) => `${PREFIJO}${workspaceId}:${claveId}`;

/* ───────────────────────────────────────────────────────────── los máximos del día ── */

/** No empieza por `trabajador:latido:`: ultimoLatido no lo confunde con un latido. */
export const claveDeCuposDelDia = (workspaceId: string) => `trabajador:cupos-del-dia:${workspaceId}`;

export type CuposDelDia = { dia: string; corriendoMax: number; enFilaMax: number; cupos: number | null };
type CuentasDelLatido = { corriendo?: unknown; enFila?: unknown; cupos?: unknown };

/** Un entero de 0 a 100; lo demás no cuenta (null). */
const cuentaValida = (valor: unknown): number | null => (typeof valor === "number" && Number.isInteger(valor) && valor >= 0 && valor <= 100 ? valor : null);

/** Lo guardado, si tiene la forma de siempre; si no, null. */
export function cuposDelDiaDeValor(valor: string | null | undefined): CuposDelDia | null {
  try {
    const leido = JSON.parse(valor ?? "") as Partial<CuposDelDia>;
    if (!leido || typeof leido.dia !== "string") return null;
    return { dia: leido.dia, corriendoMax: cuentaValida(leido.corriendoMax) ?? 0, enFilaMax: cuentaValida(leido.enFilaMax) ?? 0, cupos: cuentaValida(leido.cupos) };
  } catch {
    return null;
  }
}

/**
 * Los máximos de hoy con lo que trae este latido (pura). Al cambiar de día vuelven a cero. Devuelve null si no cambia nada
 * (no hay que escribir): solo se escribe cuando sube un máximo o cambian los cupos.
 */
export function maximosDelDia(anterior: CuposDelDia | null, entrada: CuentasDelLatido, dia: string): CuposDelDia | null {
  const corriendo = cuentaValida(entrada.corriendo);
  const enFila = cuentaValida(entrada.enFila);
  const cupos = cuentaValida(entrada.cupos);
  if (corriendo === null && enFila === null && cupos === null) return null;
  const base: CuposDelDia = anterior && anterior.dia === dia ? anterior : { dia, corriendoMax: 0, enFilaMax: 0, cupos: null };
  const nuevo: CuposDelDia = {
    dia,
    corriendoMax: Math.max(base.corriendoMax, corriendo ?? 0),
    enFilaMax: Math.max(base.enFilaMax, enFila ?? 0),
    cupos: cupos ?? base.cupos,
  };
  const igual = anterior && anterior.dia === dia && anterior.corriendoMax === nuevo.corriendoMax && anterior.enFilaMax === nuevo.enFilaMax && anterior.cupos === nuevo.cupos;
  return igual ? null : nuevo;
}

/** Guarda los máximos del día con este latido (una lectura; casi nunca una escritura). */
async function guardarCuposDelDia(workspaceId: string, cuerpo: unknown, ahora: Date) {
  if (!cuerpo || typeof cuerpo !== "object") return;
  const key = claveDeCuposDelDia(workspaceId);
  const fila = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
  const nuevo = maximosDelDia(cuposDelDiaDeValor(fila?.value), cuerpo as CuentasDelLatido, diaDeBogota(ahora));
  if (!nuevo) return;
  const value = JSON.stringify(nuevo);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Los máximos del día `dia` (AAAA-MM-DD de Bogotá), o null si no hay de ese día o no se pueden leer. Nunca lanza. */
export async function leerCuposDelDia(workspaceId: string, dia: string): Promise<CuposDelDia | null> {
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: claveDeCuposDelDia(workspaceId) }, select: { value: true } });
    const leido = cuposDelDiaDeValor(fila?.value);
    return leido && leido.dia === dia ? leido : null;
  } catch {
    return null;
  }
}

/** POST /latido: guarda el último latido de esta clave. Un cuerpo que no es un objeto es un 400. */
export async function guardarLatido(contexto: ContextoTrabajador, cuerpo: unknown, ahora = new Date()) {
  const latido = latidoDeEntrada(cuerpo, ahora, HOST_DEL_CRM);
  if (!latido) throw new ErrorDelTrabajador("El latido tiene que ser un objeto JSON.", 400);
  const key = claveDelLatido(contexto.workspaceId, contexto.claveId);
  const value = JSON.stringify(latido);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  // Los máximos del día para el resumen de las 9 p. m.: si fallan, el latido sigue.
  await guardarCuposDelDia(contexto.workspaceId, cuerpo, ahora).catch((error) =>
    console.warn("[coordinador-en-vivo] no se pudieron guardar los máximos del día", error instanceof Error ? error.message : String(error)),
  );
  // El interruptor y el umbral de la pausa por uso viajan en la respuesta: así el Coordinador los recibe cada 15 s. Si no se
  // pueden leer, se omiten (el Coordinador sigue con lo suyo).
  const pausaUso = await leerPausaPorUso(contexto.workspaceId).catch(() => null);
  return { recibidoEn: latido.recibidoEn, ...(pausaUso ? { pausaUso } : {}) };
}

/** El latido más reciente del negocio (de cualquiera de sus claves), o null. */
export async function ultimoLatido(workspaceId: string): Promise<LatidoGuardado | null> {
  const filas = await prisma.appSetting.findMany({
    where: { key: { startsWith: `${PREFIJO}${workspaceId}:` } },
    select: { value: true },
    take: 20,
  });
  const latidos = filas.map((fila) => latidoGuardado(fila.value, HOST_DEL_CRM)).filter((latido): latido is LatidoGuardado => latido !== null);
  latidos.sort((a, b) => Date.parse(b.recibidoEn) - Date.parse(a.recibidoEn));
  return latidos[0] ?? null;
}

/* ─────────────────────────────────────────────────────────────────────────── la vista ── */

export type TareaEnVivo = {
  tarjetaId: string;
  titulo: string;
  link: string;
  /** El agente del proyecto que la trabaja; null si el latido no lo trae (Coordinador viejo). */
  agente: string | null;
  etapa: EtapaVisible;
  etapaTexto: string;
  lugar: Lugar;
  lugarTexto: string;
  modelo: Modelo | null;
  modeloTexto: string | null;
  inicioEn: string | null;
  enQueVa: string;
  linkSesion: string | null;
  linkWorkflow: string | null;
  /** La línea de pasos Plan → Construir → Revisar → Aprobar → Subido (29-oct-2026). */
  pasos: PasosVista;
  /** Los 4 revisores mientras está en Revisar (vuelta R1, R2…); null si no revisa. */
  revision: RevisionVista | null;
};

export type RevisionVista = { vuelta: number; revisores: { clave: RevisorVisible; nombre: string; estado: EstadoDelRevisor }[] };

/** La revisión del latido como la muestra el panel (los 4 en orden, con su nombre). */
export function revisionVista(revision: RevisionDelLatido | null | undefined): RevisionVista | null {
  if (!revision) return null;
  return { vuelta: revision.vuelta, revisores: REVISORES_VISIBLES.map((clave) => ({ clave, nombre: NOMBRE_DEL_REVISOR[clave], estado: revision.revisores[clave] })) };
}

export type CargaVista = CargaDelLatido & { semaforo: Semaforo | null };

/** `pasos` (29-oct-2026): en las que esperan al dueño y las de ERROR, la línea de pasos con "Necesita humano". */
export type ItemDeFila = { tarjetaId: string; titulo: string; link: string; motivo: string | null; pasos?: PasosVista };

export type VistaDelCoordinador = {
  generadoEn: string;
  /** false = apagado o sin conexión (nunca mandó latido, o el último tiene más de 2 minutos). */
  enLinea: boolean;
  nunca: boolean;
  ultimoLatidoEn: string | null;
  nombre: string | null;
  tareas: TareaEnVivo[];
  carga: CargaVista | null;
  fila: { siguientes: ItemDeFila[]; bloqueadas: ItemDeFila[] };
  /** Las tarjetas del Coordinador en ERROR (26-oct-2026): cuántas son y cuáles (con la línea para el dueño, si la dejó). */
  errores: { cantidad: number; tarjetas: ItemDeFila[] };
  /** Las que esperan a otra tarjeta que no está HECHO: "Esperando a «X»" (o "…, que está en error"). Se calcula con las flechas, no es un estado. */
  esperandoAOtra: { cantidad: number; tarjetas: ItemDeFila[] };
  hoy: HoyVista;
  uso: UsoDelLatido & { texto: string };
  /**
   * El uso del plan de Claude (26-oct-2026): porcentaje de la sesión y de la semana, el estado ("Pausado por uso de Claude"),
   * y el interruptor y el umbral de la pausa (lo que el CRM tiene guardado).
   */
  usoDeClaude: { texto: string; estado: EstadoDelUsoDeClaude; activa: boolean; umbral: number; sesion: PausaUsoDelLatido["sesion"]; semana: PausaUsoDelLatido["semana"] };
};

const ESTADOS_EN_MARCHA = ["PLANEANDO", "EN_CURSO", "SUBIENDO"] as const;
const ESTADOS_DE_FILA = ["APROBADO", "PLAN_APROBADO", "SUBIENDO"] as const;
const ESTADOS_EN_ERROR = ["ERROR"] as const;
const ESTADOS_ESPERANDO_AL_DUENO = ["POR_APROBAR", "PLAN_LISTO", "POR_REVISAR"] as const;

const MOTIVO_DEL_DUENO: Record<string, string> = {
  POR_APROBAR: "Espera tu aprobación",
  PLAN_LISTO: "Espera tu aprobación del plan",
  POR_REVISAR: "Espera tu sí final",
};

async function tarjetasEnMarcha(workspaceId: string, ahora: Date) {
  return prisma.tarjetaTablero.findMany({
    where: {
      tablero: { workspaceId },
      borradoEn: null,
      estado: { in: [...ESTADOS_EN_MARCHA] },
      trabajoVenceEn: { gt: ahora },
    },
    orderBy: { trabajoIniciadoEn: "asc" },
    take: 20,
    select: { id: true, titulo: true, estado: true, intentos: true, reparaciones: true, trabajoIniciadoEn: true },
  });
}

/**
 * La vía de la última aprobación vigente (la más nueva sin deshacer, `despues.via`): la misma que lee el filtro de /tomar
 * (VIA_DE_LA_ULTIMA_APROBACION en sql-trabajador.ts). '' si no hay.
 */
function viaDelHistorial(historial: readonly { despues: unknown }[]): string {
  const despues = historial[0]?.despues;
  const via = despues && typeof despues === "object" && !Array.isArray(despues) ? (despues as { via?: unknown }).via : undefined;
  return typeof via === "string" ? via : "";
}

/**
 * "Espera que la apruebes en la pantalla (Libro V3)" si la vía de su aprobación no deja que el Coordinador la tome
 * (zonasQueEsperanLaPantalla, la misma regla que /candidatas); null si la vía alcanza. Varias zonas: "(Libro V3, Meta Ads)".
 */
export function motivoDeLaPantalla(zonas: readonly string[], via: string | null | undefined): string | null {
  const faltan = zonasQueEsperanLaPantalla(zonas, via);
  if (!faltan.length) return null;
  return `Espera que la apruebes en la pantalla (${faltan.map((zona) => (esZona(zona) ? NOMBRE_DE_LA_ZONA[zona] : zona)).join(", ")})`;
}

async function filaDelCoordinador(workspaceId: string, ahora: Date, esperas: Map<string, string>) {
  const dependencias = {
    where: { esDependencia: true, origen: { borradoEn: null, estado: { not: "HECHO" as const }, tipo: { usaEstados: true } } },
    select: { origen: { select: { titulo: true, estado: true } } },
  };
  const [paraTomar, esperandoAlDueno, enError] = await Promise.all([
    prisma.tarjetaTablero.findMany({
      where: {
        tablero: { workspaceId },
        borradoEn: null,
        repo: { not: null },
        tipo: { requiereAprobacion: true, usaEstados: true },
        OR: [
          { estado: { in: ["APROBADO", "PLAN_APROBADO"] } },
          // Una SUBIENDO sin candado vigente espera su turno de subida.
          { estado: "SUBIENDO", OR: [{ trabajoVenceEn: null }, { trabajoVenceEn: { lte: ahora } }] },
        ],
      },
      orderBy: { actualizadoEn: "asc" },
      take: 40,
      select: {
        id: true,
        titulo: true,
        detalle: true,
        estado: true,
        urgente: true,
        repo: true,
        zonaProtegida: true,
        tablero: { select: { nombre: true } },
        entrantes: dependencias,
        // La vía de la última aprobación vigente (31-oct-2026): con LIBRO_V3 o META_ADS solo la pantalla deja tomarla.
        historial: { where: { accion: "aprobar", deshechoEn: null }, orderBy: { creadoEn: "desc" }, take: 1, select: { despues: true } },
      },
    }),
    prisma.tarjetaTablero.findMany({
      where: {
        tablero: { workspaceId },
        borradoEn: null,
        repo: { not: null },
        tipo: { requiereAprobacion: true, usaEstados: true },
        estado: { in: [...ESTADOS_ESPERANDO_AL_DUENO] },
      },
      orderBy: { actualizadoEn: "asc" },
      take: MAXIMO_DE_FILA,
      select: { id: true, titulo: true, estado: true },
    }),
    prisma.tarjetaTablero.findMany({
      where: {
        tablero: { workspaceId },
        borradoEn: null,
        repo: { not: null },
        tipo: { requiereAprobacion: true, usaEstados: true },
        estado: { in: [...ESTADOS_EN_ERROR] },
      },
      orderBy: { actualizadoEn: "asc" },
      take: 50,
      select: { id: true, titulo: true, estado: true, resultado: true, plan: true },
    }),
  ]);

  const siguientes: ItemDeFila[] = [];
  const bloqueadas: ItemDeFila[] = [];
  const esperando: ItemDeFila[] = [];
  const item = (tarjeta: { id: string; titulo: string }, motivo: string | null): ItemDeFila => ({
    tarjetaId: tarjeta.id,
    titulo: tarjeta.titulo,
    link: linkDeLaTarjeta(tarjeta.id),
    motivo,
  });
  // El mismo orden con que /tomar escoge (31-oct-2026): SUBIENDO primero, después prioridadDeLaFila y, en empate, la más vieja
  // (sort es estable y paraTomar viene por actualizadoEn).
  const enOrden = paraTomar
    .map((tarjeta) => ({
      tarjeta,
      sube: tarjeta.estado === "SUBIENDO" ? 0 : 1,
      prioridad: prioridadDeLaFila({ ...tarjeta, tablero: tarjeta.tablero?.nombre ?? null }),
    }))
    .sort((a, b) => a.sube - b.sube || a.prioridad - b.prioridad)
    .map(({ tarjeta }) => tarjeta);
  for (const tarjeta of enOrden) {
    if (!(ESTADOS_DE_FILA as readonly string[]).includes(tarjeta.estado)) continue;
    const espera = tarjeta.entrantes[0]?.origen.titulo;
    // Espera la pantalla (31-oct-2026): /candidatas nunca la da, así que no va en la fila sino en bloqueadas con su motivo.
    const pantalla = motivoDeLaPantalla(tarjeta.zonaProtegida ?? [], viaDelHistorial(tarjeta.historial ?? []));
    if (espera && tarjeta.estado !== "SUBIENDO") {
      bloqueadas.push(item(tarjeta, `Espera a la tarjeta «${espera}»`));
      esperando.push(item(tarjeta, etiquetaEsperando(tarjeta.entrantes.map((entrante) => ({ titulo: entrante.origen.titulo, estado: entrante.origen.estado ?? "" })))));
    }
    else if (pantalla) {
      bloqueadas.push({ ...item(tarjeta, pantalla), pasos: pasosDeLaTarjeta({ estado: tarjeta.estado, necesitaHumano: true }) });
    } else if (esperas.has(tarjeta.id)) bloqueadas.push(item(tarjeta, esperas.get(tarjeta.id) || "Espera a que termine otra tarea"));
    else siguientes.push(item(tarjeta, null));
  }
  for (const tarjeta of esperandoAlDueno) bloqueadas.push({ ...item(tarjeta, MOTIVO_DEL_DUENO[tarjeta.estado] ?? "Espera tu sí"), pasos: pasosDeLaTarjeta({ estado: tarjeta.estado }) });
  // En ERROR: el motivo es la línea para el dueño que dejó la recogida diaria, si hay una; si la revisión de los 4 no pasó
  // (29-oct-2026), las 2 líneas que dejó el Coordinador (por qué se paró / qué decisión necesita).
  const errores = enError.map((tarjeta) => ({
    ...item(tarjeta, recogidaDelResultado(tarjeta.resultado).linea ?? lineasDeRevisionQueNoPaso(tarjeta.resultado)),
    pasos: pasosDeLaTarjeta({ estado: tarjeta.estado, pasoDelError: pasoDelError({ resultado: tarjeta.resultado, plan: tarjeta.plan }) }),
  }));
  return {
    siguientes: siguientes.slice(0, MAXIMO_DE_FILA),
    bloqueadas: bloqueadas.slice(0, MAXIMO_DE_FILA),
    errores: { cantidad: errores.length, tarjetas: errores.slice(0, MAXIMO_DE_FILA) },
    esperandoAOtra: { cantidad: esperando.length, tarjetas: esperando.slice(0, MAXIMO_DE_FILA) },
  };
}

/** Las 2 líneas para el dueño de una tarjeta en ERROR porque la revisión de los 4 no pasó; null si no es eso. */
export function lineasDeRevisionQueNoPaso(resultado: unknown): string | null {
  if (!resultado || typeof resultado !== "object" || Array.isArray(resultado)) return null;
  const error = (resultado as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const { categoria, motivo } = error as Record<string, unknown>;
  return categoria === "revision_no_paso" && typeof motivo === "string" && motivo.trim() ? motivo.trim() : null;
}

async function hoyDelCoordinador(workspaceId: string, ahora: Date): Promise<HoyVista> {
  const { desde, hasta } = rangoDeHoyEnBogota(ahora);
  const antes = new Date(desde.getTime() - HORAS_ATRAS_PARA_EL_INICIO * 3_600_000);
  const [historial, reparaciones] = await Promise.all([
    prisma.historialTarjeta.findMany({
      where: { tarjeta: { tablero: { workspaceId } }, origen: "TRABAJADOR", accion: "estado", creadoEn: { gte: antes, lt: hasta } },
      orderBy: { creadoEn: "asc" },
      take: 2000,
      select: { tarjetaId: true, creadoEn: true, despues: true, tarjeta: { select: { titulo: true } } },
    }),
    prisma.intentoTarjeta.findMany({
      where: { tarjeta: { tablero: { workspaceId } }, accion: "reparar", creadoEn: { gte: desde, lt: hasta } },
      select: { tarjetaId: true, creadoEn: true },
      take: 500,
    }),
  ]);
  const hoy = armarHoy(
    desde,
    hasta,
    historial.map((fila) => ({ tarjetaId: fila.tarjetaId, titulo: fila.tarjeta.titulo, creadoEn: fila.creadoEn, despues: fila.despues })),
    reparaciones,
  );
  return { ...hoy, trabajos: hoy.trabajos.slice(0, MAXIMO_DE_TRABAJOS_DE_HOY) };
}

/** La vista completa del panel para un negocio. Solo lee. */
export async function vistaDelCoordinador(workspaceId: string, ahora = new Date()): Promise<VistaDelCoordinador> {
  const [latido, enMarcha, hoy, ajuste] = await Promise.all([
    ultimoLatido(workspaceId),
    tarjetasEnMarcha(workspaceId, ahora),
    hoyDelCoordinador(workspaceId, ahora),
    leerPausaPorUso(workspaceId),
  ]);
  const apagado = estaApagado(latido?.recibidoEn, ahora);
  const esperas = new Map((latido?.esperas ?? []).map((espera) => [espera.tarjetaId, espera.motivo]));
  const fila = await filaDelCoordinador(workspaceId, ahora, esperas);

  // Qué hay en marcha lo dice la base; el latido agrega el detalle (dónde, modelo, intento, links).
  const delLatido = new Map((latido?.tareas ?? []).map((tarea) => [tarea.tarjetaId, tarea]));
  const tareas: TareaEnVivo[] = [];
  for (const tarjeta of enMarcha) {
    const dato = delLatido.get(tarjeta.id);
    const etapa = dato?.etapa ?? etapaDelEstado(tarjeta.estado);
    if (!etapa) continue;
    const lugar: Lugar = dato?.lugar ?? "aizen1";
    const modelo = dato?.modelo ?? null;
    tareas.push({
      tarjetaId: tarjeta.id,
      titulo: tarjeta.titulo,
      link: linkDeLaTarjeta(tarjeta.id),
      agente: dato?.agente ?? null,
      etapa,
      etapaTexto: NOMBRE_DE_LA_ETAPA[etapa],
      lugar,
      lugarTexto: NOMBRE_DEL_LUGAR[lugar],
      modelo,
      modeloTexto: modelo ? NOMBRE_DEL_MODELO[modelo] : dato?.motor === "codex" ? "Codex" : null,
      inicioEn: (dato?.inicioEn ?? tarjeta.trabajoIniciadoEn?.toISOString()) ?? null,
      enQueVa: dato ? enQueVa(dato) : enQueVa({ intento: tarjeta.intentos, reparacion: tarjeta.reparaciones, reparacionDe: null }),
      linkSesion: dato?.linkSesion ?? null,
      linkWorkflow: dato?.linkWorkflow ?? null,
      pasos: pasosDeLaTarjeta({ estado: tarjeta.estado, etapa }),
      revision: etapa === "revisando" ? revisionVista(dato?.revision) : null,
    });
  }

  const carga: CargaVista | null = latido ? { ...latido.carga, semaforo: semaforoDeLaCarga(latido.carga) } : null;
  const uso = latido?.uso ?? { limiteAlcanzado: false, reiniciaEn: null, motor: null };
  return {
    generadoEn: ahora.toISOString(),
    enLinea: !apagado,
    nunca: !latido,
    ultimoLatidoEn: latido?.recibidoEn ?? null,
    nombre: latido?.nombre ?? null,
    tareas,
    carga,
    fila: { siguientes: fila.siguientes, bloqueadas: fila.bloqueadas },
    errores: fila.errores,
    esperandoAOtra: fila.esperandoAOtra,
    hoy,
    uso: { ...uso, texto: textoDelUso(uso, ahora) },
    usoDeClaude: { ...textoDelUsoDeClaude(latido?.pausaUso ?? null, ajuste), activa: ajuste.activa, umbral: ajuste.umbral, sesion: latido?.pausaUso?.sesion ?? null, semana: latido?.pausaUso?.semana ?? null },
  };
}

const TEXTO_DEL_REVISOR: Record<EstadoDelRevisor, string> = { revisando: "revisando", aprobado: "aprobó", cambios: "pidió cambios", no_aplica: "no aplica" };

/** "Construir (Plan hecho)" / "Necesita humano en Aprobar": la línea de pasos en palabras. */
export function textoDeLosPasos(pasos: PasosVista): string {
  const actual = pasos.pasos.find((paso) => paso.clave === pasos.actual)?.nombre ?? pasos.actual;
  return pasos.necesitaHumano ? `Necesita humano en ${actual}` : actual;
}

/** "Espera tu sí" -> "espera tu sí": solo la primera letra (los nombres, como «Libro V3» o un título, quedan como están). */
const primeraEnMinuscula = (texto: string) => texto.charAt(0).toLowerCase() + texto.slice(1);

/** La misma vista en texto sencillo, para que Claude la lea por voz (herramienta MCP ver_coordinador). */
export function textoDelCoordinador(vista: VistaDelCoordinador): string {
  const ahora = new Date(vista.generadoEn).getTime();
  const lineas: string[] = [];
  if (vista.nunca) lineas.push("Coordinador apagado o sin conexión: todavía no ha mandado ningún latido.");
  else if (!vista.enLinea) {
    lineas.push(`Coordinador apagado o sin conexión: el último latido fue ${haceTexto(ahora - Date.parse(vista.ultimoLatidoEn ?? ""))}. Lo siguiente es el último dato conocido.`);
  } else lineas.push("Coordinador en línea.");

  if (vista.tareas.length) {
    lineas.push(`Ahora mismo (${vista.tareas.length}):`);
    for (const tarea of vista.tareas) {
      const desde = tarea.inicioEn ? `, empezó ${haceTexto(ahora - Date.parse(tarea.inicioEn))}` : "";
      lineas.push(`- «${tarea.titulo}»: ${tarea.etapaTexto.toLowerCase()} en ${tarea.lugarTexto}${tarea.agente ? ` (${tarea.agente})` : ""}${tarea.modeloTexto ? ` con ${tarea.modeloTexto}` : ""}${desde}, ${tarea.enQueVa}. Paso: ${textoDeLosPasos(tarea.pasos)}.`);
      if (tarea.revision) lineas.push(`  Revisión R${tarea.revision.vuelta}: ${tarea.revision.revisores.map((revisor) => `${revisor.nombre} ${TEXTO_DEL_REVISOR[revisor.estado]}`).join(", ")}.`);
    }
  } else lineas.push("Ahora mismo no tiene ninguna tarea en marcha.");

  const carga = vista.carga;
  if (carga) {
    const partes = [
      carga.cpu !== null ? `procesador ${carga.cpu} %` : null,
      carga.memoriaUsadaGb !== null && carga.memoriaTotalGb !== null ? `memoria ${carga.memoriaUsadaGb} de ${carga.memoriaTotalGb} GB` : carga.memoriaPorciento !== null ? `memoria ${carga.memoriaPorciento} %` : null,
      carga.discoLibreGb !== null ? `disco libre ${carga.discoLibreGb} GB` : null,
    ].filter(Boolean);
    const luz = carga.semaforo === "rojo" ? "ROJO (ahogado)" : carga.semaforo === "amarillo" ? "amarillo" : carga.semaforo === "verde" ? "verde" : "sin dato";
    lineas.push(`Carga de aizen1: ${luz}${partes.length ? ` — ${partes.join(", ")}` : ""}.${carga.esperandoPc ? ` Está esperando a que el PC se desocupe${carga.motivoEspera ? ` (${carga.motivoEspera})` : ""}.` : ""}`);
  }

  if (vista.fila.siguientes.length) lineas.push(`Sigue en la fila: ${vista.fila.siguientes.map((item, i) => `${i + 1}. «${item.titulo}»${item.motivo ? ` (${item.motivo})` : ""}`).join("; ")}.`);
  else lineas.push("La fila está vacía.");
  lineas.push(`En error: ${vista.errores.cantidad}${vista.errores.cantidad ? ` — ${vista.errores.tarjetas.map((item) => `«${item.titulo}»${item.motivo ? ` (${item.motivo})` : ""}`).join("; ")}` : ""}.`);
  lineas.push(`Esperando a otra: ${vista.esperandoAOtra.cantidad}${vista.esperandoAOtra.cantidad ? ` — ${vista.esperandoAOtra.tarjetas.map((item) => `«${item.titulo}» (${item.motivo ?? "espera"})`).join("; ")}` : ""}.`);
  if (vista.fila.bloqueadas.length) lineas.push(`Bloqueadas: ${vista.fila.bloqueadas.map((item) => `«${item.titulo}» (${item.motivo ? primeraEnMinuscula(item.motivo) : "espera"})`).join("; ")}.`);

  const { hoy } = vista;
  lineas.push(`Hoy: ${hoy.terminadas} terminadas, ${hoy.falladas} falladas, ${hoy.reparadas} reparadas.`);
  for (const trabajo of hoy.trabajos.slice(0, 10)) {
    lineas.push(`- «${trabajo.titulo}»: ${trabajo.resultado === "terminada" ? "terminó" : "falló"} en ${duracionTexto(trabajo.duracionMinutos)}${trabajo.reparaciones ? ` (${trabajo.reparaciones} reparación${trabajo.reparaciones === 1 ? "" : "es"})` : ""}.`);
  }
  lineas.push(`${vista.usoDeClaude.texto}${vista.usoDeClaude.activa ? ` (la pausa se activa al ${vista.usoDeClaude.umbral} %)` : ""}.`);
  lineas.push(`Límite de uso: ${vista.uso.texto}.`);
  return lineas.join("\n");
}
