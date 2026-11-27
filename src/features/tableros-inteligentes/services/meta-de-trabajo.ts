import { prisma } from "@/lib/prisma";

import {
  META_TRABAJANDO_MAXIMA,
  META_TRABAJANDO_MINIMA,
  META_TRABAJANDO_POR_DEFECTO,
  MINUTOS_BAJO_META_PARA_AVISAR,
  rangoDeHoyEnBogota,
  type CuposDelLatido,
  type EsperaDelLatido,
  type PausaUsoDelLatido,
} from "./reglas-coordinador-en-vivo";

/*
  META DE TAREAS TRABAJANDO A LA VEZ (27-nov-2026, decisión del dueño): el Coordinador debería tener al menos 10 tareas
  trabajando a la vez; si baja, el dueño tiene que saber POR QUÉ en una sola línea. Esta es la parte 1 (la base): la meta
  editable POR NEGOCIO en AppSetting (sin migración), `tablero:meta-trabajando:<negocio>` = "10", y las reglas puras que
  cuentan cuántas trabajan y arman el motivo. El aviso y la pantalla llegan en las partes 2 y 3.
  La meta NO cambia cuántas tareas corre el Coordinador (eso vive en aizen1).

  Parte 3 (27-nov-2026): el ESTADO de la meta por negocio en AppSetting `tablero:meta-trabajando:estado:<negocio>` (desde
  cuándo está por debajo, el último motivo avisado y cuándo, y los minutos con la meta cumplida hoy). Lo avanza y lo guarda
  SOLO la revisión de cada minuto (avisos-al-dueno.ts); el panel y el MCP lo leen sin escribir. La decisión de avisar es
  pura (decidirAvisoDeMeta): 15 minutos por debajo, el mismo motivo una vez por hora, uno nuevo enseguida, nunca de 9 p. m. a
  7 a. m.
*/

// Las cifras viven en reglas-coordinador-en-vivo.ts (sin prisma) para que el panel también las pueda usar.
export { META_TRABAJANDO_MAXIMA, META_TRABAJANDO_MINIMA, META_TRABAJANDO_POR_DEFECTO, MINUTOS_BAJO_META_PARA_AVISAR };

export const claveDeLaMetaTrabajando = (workspaceId: string) => `tablero:meta-trabajando:${workspaceId}`;

/** La meta (un entero de 1 a 20), o null si no lo es. No se acota: lo que se sale del rango se rechaza. */
export function metaTrabajandoValida(valor: unknown): number | null {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" && valor.trim() ? Number(valor) : NaN;
  return Number.isInteger(numero) && numero >= META_TRABAJANDO_MINIMA && numero <= META_TRABAJANDO_MAXIMA ? numero : null;
}

/** Lo guardado en la AppSetting de vuelta a la meta; lo dañado o ausente vale 10. */
export function metaTrabajandoDeValor(texto: string | null | undefined): number {
  return metaTrabajandoValida(texto) ?? META_TRABAJANDO_POR_DEFECTO;
}

/** La meta del negocio (10 si no hay fila o está dañada). */
export async function leerMetaTrabajando(workspaceId: string): Promise<number> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDeLaMetaTrabajando(workspaceId) }, select: { value: true } });
  return metaTrabajandoDeValor(fila?.value);
}

/** Cambia la meta (un entero de 1 a 20; si no, lanza un error y no guarda nada). Devuelve la meta nueva. */
export async function guardarMetaTrabajando(workspaceId: string, n: number): Promise<number> {
  // Solo un número de verdad: lo que llega de afuera como texto se rechaza (lo guardado sí se lee como texto).
  const meta = typeof n === "number" ? metaTrabajandoValida(n) : null;
  if (meta === null) throw new Error(`La meta tiene que ser un número entero entre ${META_TRABAJANDO_MINIMA} y ${META_TRABAJANDO_MAXIMA}.`);
  const key = claveDeLaMetaTrabajando(workspaceId);
  const value = String(meta);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return meta;
}

/* ───────────────────────────────────────────────────────────────── reglas puras ── */

/** Las etapas que cuentan como trabajando. Planear NO cuenta: todavía no hay nada construyéndose. */
export const ETAPAS_QUE_TRABAJAN = ["construyendo", "probando", "revisando", "subiendo", "vigilando"] as const;

/** Cuántas tareas del latido están trabajando (construyendo, probando, revisando, subiendo o vigilando). */
export function contarTrabajando(tareas: readonly { etapa: string }[]): number {
  return tareas.filter((tarea) => (ETAPAS_QUE_TRABAJAN as readonly string[]).includes(tarea.etapa)).length;
}

/** Una espera del latido con los títulos de la tarjeta y de con la que choca (si se saben). */
export type EsperaConTitulos = EsperaDelLatido & { titulo?: string | null; tituloContra?: string | null };

/** Una tarjeta que espera a otra (DEPENDE_DE): su título y el de la otra. */
export type DependenciaPendiente = { tarjetaId: string; titulo: string; esperaA: string };

export type EntradaDelMotivo = {
  trabajando: number;
  meta: number;
  /** La pausa por uso de Claude del latido, con `activa` ya puesta como la tiene guardada el CRM; null si no hay dato. */
  pausaUso: Pick<PausaUsoDelLatido, "activa" | "pausado" | "umbral" | "sesion" | "semana"> | null;
  sesionVencida: boolean;
  apagado: boolean;
  cupos: CuposDelLatido | null;
  /** Los puestos de la nube cuando ya están todos usados; null si la nube no está llena o no se sabe. */
  nubeLlena: number | null;
  /** aizen1 en rojo de CPU o memoria, o esperando que se desocupe (la cola de pasos pesados). */
  aizen1Ocupado: boolean;
  esperas: readonly EsperaConTitulos[];
  dependencias: readonly DependenciaPendiente[];
  /** Las tarjetas que esperan tu sí (el plan listo para aprobar). */
  esperanAprobacion: readonly { tarjetaId: string; titulo: string }[];
  /** Cuántas tarjetas están en error. */
  errores: number;
  /** Cuántas tarjetas hay listas para tomar. */
  candidatas: number;
};

const entre = (texto: string) => `«${texto}»`;
const yMas = (resto: number) => (resto > 0 ? ` y ${resto} más` : "");
const tarjetas = (n: number) => (n === 1 ? "1 tarjeta" : `${n} tarjetas`);
const esperan = (n: number) => (n === 1 ? "1 espera" : `${n} esperan`);

/** A qué espera una tarjeta de tipo agente, versión o motor, cuando no se sabe con qué tarjeta. */
const ESPERA_SIN_CONTRA: Record<"agente" | "version" | "motor", string> = { agente: "a otro agente", version: "otra versión", motor: "al motor" };

/** La causa que explica por qué hay menos tareas trabajando que la meta (sin el "N de M"). */
function causaBajoMeta(entrada: EntradaDelMotivo): string {
  // 1) Pausa por uso de Claude: el mayor entre la sesión y la semana, frente al umbral (es lo que dispara la pausa).
  const pausa = entrada.pausaUso;
  if (pausa?.activa && pausa.pausado) {
    const porcentajes = [pausa.sesion?.porcentaje, pausa.semana?.porcentaje].filter((valor): valor is number => typeof valor === "number");
    const umbral = pausa.umbral;
    return porcentajes.length ? `pausado por el uso de Claude (${Math.round(Math.max(...porcentajes))} % de ${umbral} %)` : `pausado por el uso de Claude (umbral ${umbral} %)`;
  }
  // 2) y 3) Sin sesión de Claude o sin Coordinador no corre nada.
  if (entrada.sesionVencida) return "la sesión de Claude en aizen1 está vencida";
  if (entrada.apagado) return "el Coordinador está apagado o sin conexión";

  // 4) Cupos o nube.
  if (entrada.cupos && entrada.cupos.cupos < entrada.meta) return `los cupos configurados dan ${entrada.cupos.cupos}, la meta es ${entrada.meta}`;
  if (entrada.nubeLlena !== null) return `la nube ya usa sus ${entrada.nubeLlena} puestos`;
  const enNube = entrada.esperas.filter((espera) => espera.tipo === "nube").length;
  if (enNube) return `la nube está llena: ${esperan(enNube)} puesto`;

  // 5) aizen1 ocupado.
  const enAizen1 = entrada.esperas.filter((espera) => espera.tipo === "aizen1").length;
  if (entrada.aizen1Ocupado || enAizen1) return enAizen1 ? `aizen1 está ocupado (CPU, memoria o pasos pesados): ${esperan(enAizen1)}` : "aizen1 está ocupado (CPU, memoria o pasos pesados)";

  // 6) Choque: nombra las dos tarjetas.
  const choques = entrada.esperas.filter((espera) => espera.tipo === "choque");
  if (choques.length) {
    const [primero] = choques;
    const contra = primero.tituloContra || primero.contra || "otra tarea";
    const motivo = primero.motivo ? ` (${primero.motivo})` : "";
    return `${entre(primero.titulo || primero.tarjetaId)} choca con ${entre(contra)}${motivo}${yMas(choques.length - 1)}`;
  }

  // 7) Esperando a otra parte: a otra tarjeta (DEPENDE_DE, o una espera de agente, versión o motor) o tu sí.
  const aOtra = new Map<string, number>();
  for (const dependencia of entrada.dependencias) aOtra.set(dependencia.esperaA, (aOtra.get(dependencia.esperaA) ?? 0) + 1);
  const sinContra = new Map<string, number>();
  for (const espera of entrada.esperas) {
    if (espera.tipo !== "agente" && espera.tipo !== "version" && espera.tipo !== "motor") continue;
    const contra = espera.tituloContra || espera.contra;
    if (contra) aOtra.set(contra, (aOtra.get(contra) ?? 0) + 1);
    else sinContra.set(ESPERA_SIN_CONTRA[espera.tipo], (sinContra.get(ESPERA_SIN_CONTRA[espera.tipo]) ?? 0) + 1);
  }
  if (aOtra.size) {
    const [[titulo, cuantas], ...resto] = [...aOtra.entries()].sort((a, b) => b[1] - a[1]);
    return `${esperan(cuantas)} a ${entre(titulo)}${yMas(resto.reduce((suma, [, n]) => suma + n, 0))}`;
  }
  if (sinContra.size) {
    const [[aQue, cuantas], ...resto] = [...sinContra.entries()].sort((a, b) => b[1] - a[1]);
    return `${esperan(cuantas)} ${aQue}${yMas(resto.reduce((suma, [, n]) => suma + n, 0))}`;
  }
  if (entrada.esperanAprobacion.length) {
    const [primera] = entrada.esperanAprobacion;
    return entrada.esperanAprobacion.length === 1 ? `${entre(primera.titulo)} espera tu sí` : `${entrada.esperanAprobacion.length} esperan tu sí`;
  }
  // Una espera sin tipo (Coordinador viejo): se dice lo que mandó.
  const sinTipo = entrada.esperas.find((espera) => espera.tipo === null);
  if (sinTipo) return `en fila: ${sinTipo.motivo || "espera a que termine otra tarea"}`;

  // 8) y 9) Errores o nada para hacer.
  if (entrada.errores > 0) return `${tarjetas(entrada.errores)} en error`;
  if (entrada.candidatas === 0) return "fila vacía";
  return `${entrada.candidatas === 1 ? "hay 1 tarjeta" : `hay ${entrada.candidatas} tarjetas`} en fila y el Coordinador todavía no la${entrada.candidatas === 1 ? "" : "s"} toma`;
}

/**
 * UNA línea con por qué hay menos tareas trabajando que la meta ("pausado por el uso de Claude (96 % de 95 %) — 4 de 10
 * trabajando"), revisando en orden: pausa por uso, sesión vencida, Coordinador apagado, cupos o nube, aizen1 ocupado,
 * choque, esperando a otra parte o tu sí, errores y fila vacía. null si ya se llega a la meta.
 */
export function motivoBajoMeta(entrada: EntradaDelMotivo): string | null {
  if (entrada.trabajando >= entrada.meta) return null;
  return `${causaBajoMeta(entrada)} — ${entrada.trabajando} de ${entrada.meta} trabajando`;
}

/* ─────────────────────────────────────────────────────────── el estado y el aviso (parte 3) ── */

const MS_MINUTO = 60_000;
/** Cada cuánto se puede repetir el aviso con el mismo motivo. */
export const MINUTOS_PARA_REPETIR_EL_MISMO_MOTIVO = 60;
/** Lo máximo que suma una vuelta a "minutos con la meta cumplida" (si el reloj se saltó vueltas, no se inventa tiempo). */
const MAXIMO_MINUTOS_POR_VUELTA = 2;

export const claveDelEstadoDeMeta = (workspaceId: string) => `tablero:meta-trabajando:estado:${workspaceId}`;

export type EstadoDeMeta = {
  /** Desde cuándo está por debajo de la meta (ISO); null si la cumple. */
  bajoMetaDesde: string | null;
  /** El último motivo avisado (el texto completo); null si nunca se avisó. */
  ultimoMotivo: string | null;
  /** Cuándo se avisó por última vez (ISO). */
  ultimoAvisoEn: string | null;
  /** Los minutos con la meta cumplida en el día `dia`. */
  minutosConMetaHoy: number;
  /** El día de Bogotá (AAAA-MM-DD) de `minutosConMetaHoy`; null si no hay. */
  dia: string | null;
  /** La última vuelta que lo avanzó (ISO). */
  ultimaRevision: string | null;
};

export const ESTADO_DE_META_VACIO: EstadoDeMeta = { bajoMetaDesde: null, ultimoMotivo: null, ultimoAvisoEn: null, minutosConMetaHoy: 0, dia: null, ultimaRevision: null };

const fechaValida = (valor: unknown): string | null => (typeof valor === "string" && Number.isFinite(Date.parse(valor)) ? valor : null);

/** Lo guardado de vuelta al estado; lo dañado o ausente cuenta como vacío (campo por campo). */
export function estadoDeMetaDeValor(texto: string | null | undefined): EstadoDeMeta {
  try {
    const leido = JSON.parse(texto ?? "") as Partial<Record<keyof EstadoDeMeta, unknown>> | null;
    if (!leido || typeof leido !== "object" || Array.isArray(leido)) return { ...ESTADO_DE_META_VACIO };
    const minutos = typeof leido.minutosConMetaHoy === "number" && Number.isFinite(leido.minutosConMetaHoy) && leido.minutosConMetaHoy >= 0 ? Math.min(leido.minutosConMetaHoy, 24 * 60) : 0;
    return {
      bajoMetaDesde: fechaValida(leido.bajoMetaDesde),
      ultimoMotivo: typeof leido.ultimoMotivo === "string" && leido.ultimoMotivo.trim() ? leido.ultimoMotivo : null,
      ultimoAvisoEn: fechaValida(leido.ultimoAvisoEn),
      minutosConMetaHoy: minutos,
      dia: typeof leido.dia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(leido.dia) ? leido.dia : null,
      ultimaRevision: fechaValida(leido.ultimaRevision),
    };
  } catch {
    return { ...ESTADO_DE_META_VACIO };
  }
}

/** El estado de la meta del negocio (vacío si no hay fila o está dañada). */
export async function leerEstadoDeMeta(workspaceId: string): Promise<EstadoDeMeta> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDelEstadoDeMeta(workspaceId) }, select: { value: true } });
  return estadoDeMetaDeValor(fila?.value);
}

export async function guardarEstadoDeMeta(workspaceId: string, estado: EstadoDeMeta): Promise<void> {
  const key = claveDelEstadoDeMeta(workspaceId);
  const value = JSON.stringify(estado);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** El día de Bogotá (AAAA-MM-DD) de `ahora`. */
export function diaDeLaMeta(ahora: Date): string {
  const { desde } = rangoDeHoyEnBogota(ahora);
  return new Date(desde.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Una vuelta del reloj (pura): pone `bajoMetaDesde` la primera vez que baja de la meta y lo borra al cumplirla; con la meta
 * cumplida suma los minutos desde la vuelta anterior (máximo 2 por vuelta) y vuelve a 0 al cambiar el día de Bogotá.
 * No toca el último aviso.
 */
export function avanzarEstadoDeMeta(estado: EstadoDeMeta, { trabajando, meta, ahora }: { trabajando: number; meta: number; ahora: Date }): EstadoDeMeta {
  const dia = diaDeLaMeta(ahora);
  const cumple = trabajando >= meta;
  const anterior = estado.ultimaRevision ? Date.parse(estado.ultimaRevision) : NaN;
  // En el cambio de día solo cuenta lo que va de hoy.
  const desdeHoy = rangoDeHoyEnBogota(ahora).desde.getTime();
  const base = Number.isFinite(anterior) ? Math.max(anterior, estado.dia === dia ? anterior : desdeHoy) : NaN;
  const transcurridos = Number.isFinite(base) ? Math.min(MAXIMO_MINUTOS_POR_VUELTA, Math.max(0, (ahora.getTime() - base) / MS_MINUTO)) : 0;
  const minutosDeHoy = estado.dia === dia ? estado.minutosConMetaHoy : 0;
  return {
    ...estado,
    bajoMetaDesde: cumple ? null : (estado.bajoMetaDesde ?? ahora.toISOString()),
    minutosConMetaHoy: Math.min(24 * 60, minutosDeHoy + (cumple ? transcurridos : 0)),
    dia,
    ultimaRevision: ahora.toISOString(),
  };
}

/**
 * El motivo sin el "— X de N trabajando" y con las cifras cambiadas por `#`: así "4 de 10" contra "5 de 10" (o 96 % contra
 * 97 %) no cuenta como un motivo nuevo.
 */
export function claveDelMotivo(motivo: string): string {
  return motivo
    .replace(/\s*—\s*\d+ de \d+ trabajando\s*$/, "")
    .replace(/\d+/g, "#")
    .trim();
}

/** ¿Es hora de silencio (9:00 p. m. a 6:59 a. m. de Bogotá)? La misma regla que enSilencioDeAvisos de avisos-al-dueno.ts. */
export function enSilencioDeLaMeta(ahora: Date): boolean {
  const hora = new Date(ahora.getTime() - 5 * 3_600_000).getUTCHours();
  return hora >= 21 || hora < 7;
}

export type DecisionDeMeta = { avisar: true } | { avisar: false; porque: "sin_motivo" | "poco_tiempo" | "silencio" | "repetido" };

/**
 * ¿Se avisa al dueño en esta vuelta? (pura, con el estado YA avanzado). No, si no hay motivo, si lleva menos de 15 minutos
 * por debajo o si es de 9 p. m. a 7 a. m. Si el motivo cambió, enseguida; si es el mismo, solo pasados 60 minutos del último.
 */
export function decidirAvisoDeMeta(estado: Pick<EstadoDeMeta, "bajoMetaDesde" | "ultimoMotivo" | "ultimoAvisoEn">, motivo: string | null, ahora: Date): DecisionDeMeta {
  if (!motivo) return { avisar: false, porque: "sin_motivo" };
  const desde = estado.bajoMetaDesde ? Date.parse(estado.bajoMetaDesde) : NaN;
  if (!Number.isFinite(desde) || ahora.getTime() - desde < MINUTOS_BAJO_META_PARA_AVISAR * MS_MINUTO) return { avisar: false, porque: "poco_tiempo" };
  if (enSilencioDeLaMeta(ahora)) return { avisar: false, porque: "silencio" };
  if (!estado.ultimoMotivo || claveDelMotivo(estado.ultimoMotivo) !== claveDelMotivo(motivo)) return { avisar: true };
  const ultimo = estado.ultimoAvisoEn ? Date.parse(estado.ultimoAvisoEn) : NaN;
  if (!Number.isFinite(ultimo) || ahora.getTime() - ultimo >= MINUTOS_PARA_REPETIR_EL_MISMO_MOTIVO * MS_MINUTO) return { avisar: true };
  return { avisar: false, porque: "repetido" };
}

/** Las horas con la meta cumplida hoy (con un decimal), según lo guardado; 0 si lo guardado es de otro día. */
export function horasConMetaDeHoy(estado: Pick<EstadoDeMeta, "minutosConMetaHoy" | "dia">, ahora: Date): number {
  if (estado.dia !== diaDeLaMeta(ahora)) return 0;
  return Math.round((estado.minutosConMetaHoy / 60) * 10) / 10;
}
