import { prisma } from "@/lib/prisma";

import {
  type CargaDelLatido,
  type CuposDelLatido,
  type EtapaVisible,
  type PausaUsoDelLatido,
  type TipoDeEspera,
  LIMITE_ROJO,
} from "./reglas-coordinador-en-vivo";

/*
  META DE TAREAS TRABAJANDO A LA VEZ (27-nov-2026, decisión del dueño, parte 1 de 3): el Coordinador debería tener al menos
  10 tarjetas trabajando a la vez. Acá vive la meta, POR NEGOCIO, en AppSetting (sin migración), como la pausa por uso de
  Claude (pausa-por-uso-de-claude.ts): `tablero:meta-trabajando:<negocio>` = el número (1 a 20). Sin fila: 10.
  También las reglas PURAS para contar cuántas trabajan y decir, en UNA línea, por qué hay menos que la meta. El aviso al
  dueño y la pantalla llegan en las partes 2 y 3. Esto NO cambia cuántas tareas corre el Coordinador (eso vive en aizen1).
*/

export const META_TRABAJANDO_POR_DEFECTO = 10;
export const META_TRABAJANDO_MINIMA = 1;
export const META_TRABAJANDO_MAXIMA = 20;

export const claveDeLaMetaTrabajando = (workspaceId: string) => `tablero:meta-trabajando:${workspaceId}`;

/** La meta (un entero de 1 a 20), o null si no es un número entero en ese rango. */
export function metaTrabajandoValida(valor: unknown): number | null {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" && valor.trim() ? Number(valor) : NaN;
  if (!Number.isInteger(numero)) return null;
  return numero >= META_TRABAJANDO_MINIMA && numero <= META_TRABAJANDO_MAXIMA ? numero : null;
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

/** Cambia la meta (1 a 20); lo de afuera de ese rango se rechaza sin guardar. Devuelve la meta nueva. */
export async function guardarMetaTrabajando(workspaceId: string, meta: number): Promise<number> {
  const valida = typeof meta === "number" ? metaTrabajandoValida(meta) : null;
  if (valida === null) throw new Error(`La meta tiene que ser un número entero entre ${META_TRABAJANDO_MINIMA} y ${META_TRABAJANDO_MAXIMA}.`);
  const key = claveDeLaMetaTrabajando(workspaceId);
  const value = String(valida);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return valida;
}

/* ───────────────────────────────────────────────────────────────── contar y explicar (puras) ── */

/** Las etapas que cuentan como "trabajando". Planear NO cuenta: todavía no se construye nada. */
export const ETAPAS_TRABAJANDO: readonly EtapaVisible[] = ["construyendo", "probando", "revisando", "subiendo", "vigilando"];

/** Cuántas tareas del latido están trabajando (construyendo, probando, revisando, subiendo o vigilando). */
export function contarTrabajando(tareas: readonly { etapa: string }[]): number {
  return tareas.filter((tarea) => (ETAPAS_TRABAJANDO as readonly string[]).includes(tarea.etapa)).length;
}

/** "4 de 10": cuántas trabajan frente a la meta. */
export function trabajandoDeLaMeta(trabajando: number, meta: number): string {
  return `${trabajando} de ${meta}`;
}

/** ¿aizen1 está ocupado? CPU o memoria en rojo (más de 85 %), o el Coordinador espera que el PC se desocupe (cola de pasos pesados). */
export function aizen1EstaOcupado(carga: Pick<CargaDelLatido, "cpu" | "memoriaPorciento" | "esperandoPc"> | null): boolean {
  if (!carga) return false;
  return carga.esperandoPc || [carga.cpu, carga.memoriaPorciento].some((valor) => valor !== null && valor > LIMITE_ROJO);
}

/** Una espera de la fila con los títulos ya buscados: el de la tarjeta y el de la tarjeta con la que choca (`contra`). */
export type EsperaParaElMotivo = {
  tarjetaId: string;
  titulo: string;
  motivo: string;
  tipo: TipoDeEspera | null;
  contra: string | null;
  tituloContra: string | null;
};

/** Una tarjeta de la fila que espera a otra tarjeta (una dependencia): el título de la que espera. */
export type DependenciaParaElMotivo = { tarjetaId: string; esperaA: string };

export type EntradaDelMotivo = {
  trabajando: number;
  meta: number;
  /** La pausa por uso de Claude del latido; cuenta solo si está pausado y la pausa está prendida. */
  pausaUso: Pick<PausaUsoDelLatido, "activa" | "pausado" | "umbral" | "sesion" | "semana"> | null;
  sesionVencida: boolean;
  apagado: boolean;
  cupos: CuposDelLatido | null;
  /** Cuántos puestos de la nube están en uso, si la nube está llena; null si no lo está o no se sabe. */
  nubeLlena: { puestos: number } | null;
  aizen1Ocupado: boolean;
  esperas: readonly EsperaParaElMotivo[];
  dependencias: readonly DependenciaParaElMotivo[];
  /** Cuántas tarjetas esperan tu sí al plan. */
  esperanTuSi: number;
  errores: number;
  /** Cuántas tarjetas hay en la fila listas para tomar. */
  candidatas: number;
};

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);
const yMas = (n: number) => (n > 0 ? ` (y ${n} más)` : "");

const ESPERA_A_OTRA_PARTE: Partial<Record<TipoDeEspera, string>> = {
  agente: "a su agente",
  version: "una versión nueva",
  motor: "al motor (Claude o Codex)",
};

/** "pausado por el uso de Claude (96 % de 95 %)": el mayor entre la sesión y la semana, frente al umbral. */
function textoDeLaPausa(pausa: NonNullable<EntradaDelMotivo["pausaUso"]>): string {
  const porcentajes = [pausa.sesion?.porcentaje, pausa.semana?.porcentaje].filter((valor): valor is number => typeof valor === "number");
  if (!porcentajes.length) return `pausado por el uso de Claude (la pausa se activa al ${pausa.umbral} %)`;
  return `pausado por el uso de Claude (${Math.round(Math.max(...porcentajes))} % de ${pausa.umbral} %)`;
}

/**
 * Por qué hay menos tareas trabajando que la meta, en UNA línea (null si se llega a la meta). Revisa en este orden y dice la
 * primera causa que encuentra: 1) pausa por uso de Claude; 2) sesión de Claude vencida; 3) Coordinador apagado; 4) cupos o
 * nube llena; 5) aizen1 ocupado; 6) choque entre dos tarjetas (una espera sin tipo, de un Coordinador viejo, sale acá como
 * "en fila: <texto>"); 7) esperando a otra parte (otra tarjeta, su agente, una versión, el motor) o tu sí; 8) tarjetas en
 * error; 9) fila vacía.
 */
export function motivoBajoMeta(entrada: EntradaDelMotivo): string | null {
  const { trabajando, meta } = entrada;
  if (trabajando >= meta) return null;

  // 1) Pausa por uso de Claude.
  if (entrada.pausaUso?.pausado && entrada.pausaUso.activa) return textoDeLaPausa(entrada.pausaUso);
  // 2) Sesión de Claude vencida.
  if (entrada.sesionVencida) return "la sesión de Claude en aizen1 está vencida (en aizen1: claude auth login)";
  // 3) Coordinador apagado.
  if (entrada.apagado) return "el Coordinador está apagado o sin conexión";

  // 4) Cupos o nube.
  if (entrada.cupos && entrada.cupos.cupos < meta) return `los cupos configurados dan ${entrada.cupos.cupos}, la meta es ${meta}`;
  const enNube = entrada.esperas.filter((espera) => espera.tipo === "nube").length;
  if (entrada.nubeLlena) return `la nube ya usa sus ${entrada.nubeLlena.puestos} puestos`;
  if (enNube) return `la nube está llena: ${enNube} ${plural(enNube, "espera", "esperan")} un puesto`;

  // 5) aizen1 ocupado.
  if (entrada.aizen1Ocupado || entrada.esperas.some((espera) => espera.tipo === "aizen1")) {
    return "aizen1 está ocupado (CPU o memoria en rojo, o cola de pasos pesados)";
  }

  // 6) Choque entre dos tarjetas; una espera sin tipo (Coordinador viejo) sale como "en fila: <texto>".
  const choques = entrada.esperas.filter((espera) => espera.tipo === "choque");
  if (choques.length) {
    const [primero] = choques;
    const otra = primero.tituloContra || primero.contra || "otra tarea";
    return `«${primero.titulo}» choca con «${otra}»${primero.motivo ? ` (${primero.motivo})` : ""}${yMas(choques.length - 1)}`;
  }
  const sinTipo = entrada.esperas.filter((espera) => espera.tipo === null);
  if (sinTipo.length) return `en fila: ${sinTipo[0].motivo || `«${sinTipo[0].titulo}» espera`}${yMas(sinTipo.length - 1)}`;

  // 7) Esperando a otra parte: otra tarjeta, su agente, una versión, el motor, o tu sí.
  const partes: string[] = [];
  if (entrada.dependencias.length) {
    const porTarjeta = new Map<string, number>();
    for (const dependencia of entrada.dependencias) porTarjeta.set(dependencia.esperaA, (porTarjeta.get(dependencia.esperaA) ?? 0) + 1);
    const [[aCual, cuantas]] = [...porTarjeta.entries()].sort((a, b) => b[1] - a[1]);
    const resto = entrada.dependencias.length - cuantas;
    partes.push(`${cuantas} ${plural(cuantas, "espera", "esperan")} a «${aCual}»${resto ? ` y ${resto} a otras` : ""}`);
  }
  for (const [tipo, aQuien] of Object.entries(ESPERA_A_OTRA_PARTE) as [TipoDeEspera, string][]) {
    const cuantas = entrada.esperas.filter((espera) => espera.tipo === tipo).length;
    if (cuantas) partes.push(`${cuantas} ${plural(cuantas, "espera", "esperan")} ${aQuien}`);
  }
  if (entrada.esperanTuSi > 0) partes.push(`${entrada.esperanTuSi} ${plural(entrada.esperanTuSi, "espera", "esperan")} tu sí al plan`);
  if (partes.length) return partes.join("; ");

  // 8) Tarjetas en error.
  if (entrada.errores > 0) return `${entrada.errores} ${plural(entrada.errores, "tarjeta en error", "tarjetas en error")}`;

  // 9) Fila vacía.
  if (entrada.candidatas <= 0) return "fila vacía";
  return `${entrada.candidatas} en fila, todavía sin tomar`;
}
