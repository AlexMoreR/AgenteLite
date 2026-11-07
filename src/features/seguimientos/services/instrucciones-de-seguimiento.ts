import { prisma } from "@/lib/prisma";
import {
  CLAVE_HISTORIAL_DE_INSTRUCCIONES,
  CLAVE_INSTRUCCIONES,
  INSTRUCCIONES_ORIGINALES,
  instruccionesDeLaVersion,
  leerHistorialGuardado,
  leerInstruccionesGuardadas,
  nuevaVersion,
  type CambioDeInstrucciones,
  type InstruccionesGuardadas,
} from "@/features/seguimientos/dominio/instrucciones-de-seguimiento";

/**
 * Donde se guardan las instrucciones de los seguimientos con IA y su historial (AppSetting, una fila
 * por negocio, como el libro V3). Lo usan el MCP (ver, cambiar, historial, volver) y el redactor.
 */

/** Las instrucciones guardadas del negocio. Si la fila esta rota, lanza: el MCP lo dice y no guarda encima. */
export async function leerInstrucciones(workspaceId: string): Promise<InstruccionesGuardadas> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE_INSTRUCCIONES}${workspaceId}` } });
  const guardadas = leerInstruccionesGuardadas(fila?.value ?? null);
  if (!guardadas) {
    throw new Error(
      "Las instrucciones guardadas están ilegibles: los seguimientos usan las reglas de siempre. Para arreglarlo, vuelve a la versión 0 con volver_instrucciones_de_seguimientos.",
    );
  }
  return guardadas;
}

/** El historial del negocio, del cambio mas nuevo al mas viejo. */
export async function leerHistorialDeInstrucciones(workspaceId: string): Promise<CambioDeInstrucciones[]> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE_HISTORIAL_DE_INSTRUCCIONES}${workspaceId}` } });
  return leerHistorialGuardado(fila?.value ?? null);
}

/**
 * Para el redactor: nunca lanza. Si la fila falta, la version 0; si esta rota o la base falla, null
 * (las reglas de siempre) y queda en el registro. Nunca frena un envio.
 */
export async function leerInstruccionesParaRedactar(workspaceId: string): Promise<InstruccionesGuardadas | null> {
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE_INSTRUCCIONES}${workspaceId}` } });
    const guardadas = leerInstruccionesGuardadas(fila?.value ?? null);
    if (!guardadas) console.warn("[seguimiento-que-escucha] instrucciones guardadas ilegibles; van las de siempre", { workspaceId });
    return guardadas;
  } catch (error) {
    console.warn("[seguimiento-que-escucha] no se pudieron leer las instrucciones; van las de siempre", {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function escribir(workspaceId: string, instrucciones: InstruccionesGuardadas, historial: CambioDeInstrucciones[]) {
  const claveHistorial = `${CLAVE_HISTORIAL_DE_INSTRUCCIONES}${workspaceId}`;
  const clave = `${CLAVE_INSTRUCCIONES}${workspaceId}`;
  // Primero el historial: si lo segundo falla, la foto de antes ya quedo y no se pierde nada.
  await prisma.appSetting.upsert({
    where: { key: claveHistorial },
    create: { key: claveHistorial, value: JSON.stringify(historial) },
    update: { value: JSON.stringify(historial) },
  });
  await prisma.appSetting.upsert({
    where: { key: clave },
    create: { key: clave, value: JSON.stringify(instrucciones) },
    update: { value: JSON.stringify(instrucciones) },
  });
}

/**
 * Guarda las instrucciones nuevas si la version leida sigue siendo la actual. Sube la version y deja
 * la foto anterior en el historial. Activo al instante: el siguiente seguimiento ya las usa.
 */
export async function guardarInstrucciones(input: {
  workspaceId: string;
  versionLeida: number;
  nuevas: InstruccionesGuardadas;
  quien: string;
  resumen: string;
}): Promise<InstruccionesGuardadas> {
  const [actual, historial] = await Promise.all([leerInstrucciones(input.workspaceId), leerHistorialDeInstrucciones(input.workspaceId)]);
  if (actual.version !== input.versionLeida) {
    throw new Error(
      `No se guardó: las instrucciones cambiaron (leíste la versión ${input.versionLeida} y ahora es la ${actual.version}). Vuelve a leerlas con ver_instrucciones_de_seguimientos.`,
    );
  }
  const resultado = nuevaVersion({ actual, nuevas: input.nuevas, historial, quien: input.quien, resumen: input.resumen, ahora: new Date() });
  await escribir(input.workspaceId, resultado.instrucciones, resultado.historial);
  return resultado.instrucciones;
}

/**
 * Vuelve a una version (sin numero, a la anterior). Volver tambien es un cambio: deja una version
 * nueva y la foto de lo que habia. La 0 son las reglas de siempre. Si lo guardado esta ilegible,
 * solo se puede volver a la 0.
 */
export async function volverInstrucciones(input: {
  workspaceId: string;
  version: number | null;
  quien: string;
}): Promise<{ instrucciones: InstruccionesGuardadas; desde: number; a: number }> {
  const historial = await leerHistorialDeInstrucciones(input.workspaceId);
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE_INSTRUCCIONES}${input.workspaceId}` } });
  const leida = leerInstruccionesGuardadas(fila?.value ?? null);
  // Ilegible: se toma como version la mas alta del historial, para no repetir numeros.
  const actual: InstruccionesGuardadas = leida ?? { ...INSTRUCCIONES_ORIGINALES, version: historial[0]?.version ?? 0 };
  if (!leida && input.version !== 0) {
    throw new Error("Las instrucciones guardadas están ilegibles: solo se puede volver a la versión 0 (las reglas de siempre).");
  }

  const destino = input.version ?? actual.version - 1;
  if (!Number.isInteger(destino) || destino < 0) {
    throw new Error(actual.version === 0 ? "Ya están las reglas de siempre (versión 0): no hay versión anterior." : "La versión tiene que ser un número entero desde 0.");
  }
  if (destino === actual.version && leida) {
    throw new Error(`La versión ${destino} es la que está activa: no hay nada que volver.`);
  }
  if (destino > actual.version) throw new Error(`No existe la versión ${destino}: la actual es la ${actual.version}.`);
  const foto = instruccionesDeLaVersion(actual, historial, destino);
  if (!foto) throw new Error(`La versión ${destino} ya no está en el historial (se guardan las últimas 30).`);

  const resultado = nuevaVersion({
    actual,
    nuevas: foto,
    historial,
    quien: input.quien,
    resumen: destino === 0 ? "Volver a la versión 0 (las reglas de siempre)" : `Volver a la versión ${destino}`,
    ahora: new Date(),
  });
  await escribir(input.workspaceId, resultado.instrucciones, resultado.historial);
  return { instrucciones: resultado.instrucciones, desde: actual.version, a: destino };
}
