import { prisma } from "@/lib/prisma";

import { LIBRO_VACIO, revisarLibro, type LibroDeReglas } from "../domain/reglas";

/**
 * Dónde vive el libro de reglas, y su historial.
 *
 * En AppSetting, una fila por negocio, como el resto de lo que se agregó sin migrar la base de
 * producción. Cada guardado deja la versión anterior completa: volver atrás es copiar una foto,
 * no reconstruir nada a mano.
 *
 * El V3 NO toca al V2 mientras tanto. El V2 sigue vendiendo con su diagrama y su prompt; esto se
 * escribe, se prueba en el simulador, y recién cuando gane se conecta a una línea (Alex,
 * 21-sep-2026).
 */

const CLAVE_LIBRO = "agente-v3:libro:";
const CLAVE_HISTORIAL = "agente-v3:historial:";
const MAXIMO_DE_VERSIONES = 30;

/**
 * Una fila del historial = UN CAMBIO del libro.
 *
 * `version` y `libro` son la FOTO de cómo estaba el libro ANTES del cambio (con eso se vuelve atrás, y así lo leen
 * el Supervisor y el relleno del embudo). `resumen`, `autor` y `at` son del cambio, que dejó el libro en
 * `versionResultante` (= version + 1). Las filas viejas (antes del 27-oct-2026) no traen `versionResultante`: para
 * ellas se calcula version + 1, que es exactamente lo que siempre hizo `guardarLibro`. Por eso no hay que migrar nada.
 */
export type VersionDelLibro = {
  version: number;
  /** La versión que dejó este cambio. Falta en las filas viejas: usar `versionResultanteDe`. */
  versionResultante?: number;
  at: string;
  autor: string;
  /** Qué cambió, en una línea: "Regla nueva: pide fotos del combo". */
  resumen: string;
  libro: LibroDeReglas;
};

/** La versión que resultó del cambio de esa fila (sirve para filas nuevas y viejas). */
export function versionResultanteDe(fila: Pick<VersionDelLibro, "version" | "versionResultante">): number {
  return typeof fila.versionResultante === "number" ? fila.versionResultante : (fila.version ?? 0) + 1;
}

export type CambioDelHistorial = {
  /** La versión que dejó el cambio: "318 · Regla nueva…" es el cambio que creó la 318. */
  version: number;
  /** La versión que había antes del cambio. */
  anterior: number;
  at: string;
  autor: string;
  resumen: string;
  /** Cuántas reglas quedaron en la versión que dejó el cambio (null si esa foto ya no está guardada). */
  reglas: number | null;
};

/**
 * El historial como lista de cambios, cada uno con el número de la versión que RESULTÓ (no la anterior). Para
 * mostrar (MCP v3_historial). Pura: recibe el libro actual y las filas tal como están guardadas.
 */
export function cambiosDelHistorial(actual: LibroDeReglas, historial: readonly VersionDelLibro[]): CambioDelHistorial[] {
  const reglasPorVersion = new Map<number, number>();
  for (const fila of historial) reglasPorVersion.set(fila.version, fila.libro?.reglas?.length ?? 0);
  reglasPorVersion.set(actual.version, actual.reglas.length);
  return historial.map((fila) => {
    const version = versionResultanteDe(fila);
    return { version, anterior: fila.version, at: fila.at, autor: fila.autor, resumen: fila.resumen, reglas: reglasPorVersion.get(version) ?? null };
  });
}

export async function leerLibro(workspaceId: string): Promise<LibroDeReglas> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE_LIBRO}${workspaceId}` } });
  if (!fila?.value) {
    return LIBRO_VACIO;
  }
  try {
    const guardado = JSON.parse(fila.value) as LibroDeReglas;
    return { ...LIBRO_VACIO, ...guardado, reglas: Array.isArray(guardado.reglas) ? guardado.reglas : [] };
  } catch {
    return LIBRO_VACIO;
  }
}

export async function leerHistorialDelLibro(workspaceId: string): Promise<VersionDelLibro[]> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE_HISTORIAL}${workspaceId}` } });
  if (!fila?.value) {
    return [];
  }
  try {
    const guardado = JSON.parse(fila.value) as unknown;
    return Array.isArray(guardado) ? (guardado as VersionDelLibro[]) : [];
  } catch {
    return [];
  }
}

/**
 * Guarda el libro y anota la versión anterior.
 *
 * Devuelve los problemas que encontró (frases demasiado cortas, reglas que no hacen nada) sin
 * bloquear: quien dicta la regla decide si le importan. Bloquear acá obligaría a pelear con la
 * herramienta en medio de una conversación.
 */
export async function guardarLibro(input: {
  workspaceId: string;
  libro: LibroDeReglas;
  autor: string;
  resumen: string;
}): Promise<{ version: number; problemas: string[] }> {
  const anterior = await leerLibro(input.workspaceId);
  const siguiente: LibroDeReglas = {
    ...input.libro,
    version: (anterior.version ?? 0) + 1,
    actualizadoEl: new Date().toISOString(),
  };

  const historial = await leerHistorialDelLibro(input.workspaceId);
  // La foto es la del libro ANTERIOR (para volver a ella); el resumen y el autor son del cambio que deja `siguiente`.
  const versionGuardada: VersionDelLibro = {
    version: anterior.version ?? 0,
    versionResultante: siguiente.version,
    at: new Date().toISOString(),
    autor: input.autor,
    resumen: input.resumen,
    libro: anterior,
  };

  await prisma.$transaction([
    prisma.appSetting.upsert({
      where: { key: `${CLAVE_LIBRO}${input.workspaceId}` },
      create: { key: `${CLAVE_LIBRO}${input.workspaceId}`, value: JSON.stringify(siguiente) },
      update: { value: JSON.stringify(siguiente) },
    }),
    prisma.appSetting.upsert({
      where: { key: `${CLAVE_HISTORIAL}${input.workspaceId}` },
      create: {
        key: `${CLAVE_HISTORIAL}${input.workspaceId}`,
        value: JSON.stringify([versionGuardada, ...historial].slice(0, MAXIMO_DE_VERSIONES)),
      },
      update: {
        value: JSON.stringify([versionGuardada, ...historial].slice(0, MAXIMO_DE_VERSIONES)),
      },
    }),
  ]);

  return { version: siguiente.version, problemas: revisarLibro(siguiente) };
}

/**
 * Vuelve a una versión guardada. La actual queda anotada como una versión más: no se pierde.
 *
 * `version` es el número real del libro (el que muestra v3_historial). La foto de la versión N está en la fila cuyo
 * `version` (foto de antes del cambio) es N; la versión actual no tiene foto en el historial porque es la de ahora.
 */
export async function volverAVersion(input: {
  workspaceId: string;
  version: number;
  autor: string;
}): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const [actual, historial] = await Promise.all([leerLibro(input.workspaceId), leerHistorialDelLibro(input.workspaceId)]);
  if (input.version === actual.version) {
    return { ok: false, error: `La versión ${input.version} es la actual: no hay que volver a ella` };
  }
  const guardada = historial.find((fila) => fila.version === input.version);
  if (!guardada) {
    return { ok: false, error: "Esa versión ya no está guardada" };
  }
  const resultado = await guardarLibro({
    workspaceId: input.workspaceId,
    libro: guardada.libro,
    autor: input.autor,
    resumen: `Volvió a la versión ${input.version}`,
  });
  return { ok: true, version: resultado.version };
}
