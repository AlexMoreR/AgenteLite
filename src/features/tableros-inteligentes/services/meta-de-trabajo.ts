import { prisma } from "@/lib/prisma";

import { type CuposDelLatido, type EsperaDelLatido, type PausaUsoDelLatido } from "./reglas-coordinador-en-vivo";

/*
  META DE TAREAS TRABAJANDO A LA VEZ (27-nov-2026, decisión del dueño): el Coordinador debería tener al menos 10 tareas
  trabajando a la vez; si baja, el dueño tiene que saber POR QUÉ en una sola línea. Esta es la parte 1 (la base): la meta
  editable POR NEGOCIO en AppSetting (sin migración), `tablero:meta-trabajando:<negocio>` = "10", y las reglas puras que
  cuentan cuántas trabajan y arman el motivo. El aviso y la pantalla llegan en las partes 2 y 3.
  La meta NO cambia cuántas tareas corre el Coordinador (eso vive en aizen1).
*/

export const META_TRABAJANDO_POR_DEFECTO = 10;
export const META_TRABAJANDO_MINIMA = 1;
export const META_TRABAJANDO_MAXIMA = 20;

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
