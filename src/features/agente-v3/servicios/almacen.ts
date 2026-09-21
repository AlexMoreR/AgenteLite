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

export type VersionDelLibro = {
  version: number;
  at: string;
  autor: string;
  /** Qué cambió, en una línea: "Regla nueva: pide fotos del combo". */
  resumen: string;
  libro: LibroDeReglas;
};

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
  const versionGuardada: VersionDelLibro = {
    version: anterior.version ?? 0,
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

/** Vuelve a una versión guardada. La actual queda anotada como una versión más: no se pierde. */
export async function volverAVersion(input: {
  workspaceId: string;
  version: number;
  autor: string;
}): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const historial = await leerHistorialDelLibro(input.workspaceId);
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
