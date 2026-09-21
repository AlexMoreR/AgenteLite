import { prisma } from "@/lib/prisma";

import type { EstadoDeLaCharla } from "./decidir";

/**
 * En qué va cada conversación: producto, paso y qué flujos ya se enviaron.
 *
 * Vive en AppSetting, una fila por conversación, para no migrar la base de producción mientras el
 * V3 se prueba. Cuando el V3 reemplace al V2 esto se muda a una columna de Conversation, que es su
 * lugar natural; hasta entonces, una fila suelta no le hace daño a nadie.
 *
 * Es el dato que el V2 nunca guardó bien y por eso se repetía: sin saber qué flujo ya salió, el
 * agente reenviaba el mismo catálogo dos veces en la misma charla.
 */

const CLAVE = "agente-v3:estado:";

export async function leerEstado(conversationId: string): Promise<EstadoDeLaCharla> {
  const vacio: EstadoDeLaCharla = {
    productoActivo: null,
    pasoActual: null,
    flujosEnviados: [],
    esPrimerMensaje: true,
  };
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE}${conversationId}` } });
  if (!fila?.value) {
    return vacio;
  }
  try {
    const guardado = JSON.parse(fila.value) as Partial<EstadoDeLaCharla>;
    return {
      productoActivo: typeof guardado.productoActivo === "string" ? guardado.productoActivo : null,
      pasoActual: (guardado.pasoActual as EstadoDeLaCharla["pasoActual"]) ?? null,
      flujosEnviados: Array.isArray(guardado.flujosEnviados)
        ? guardado.flujosEnviados.filter((id): id is string => typeof id === "string")
        : [],
      esPrimerMensaje: guardado.esPrimerMensaje === true,
    };
  } catch {
    return vacio;
  }
}

export async function guardarEstado(conversationId: string, estado: EstadoDeLaCharla): Promise<void> {
  const value = JSON.stringify({
    productoActivo: estado.productoActivo,
    pasoActual: estado.pasoActual,
    // Se recortan: una charla larga no necesita recordar cincuenta envíos, y la fila no crece sola.
    flujosEnviados: estado.flujosEnviados.slice(-20),
    esPrimerMensaje: estado.esPrimerMensaje,
  });
  await prisma.appSetting.upsert({
    where: { key: `${CLAVE}${conversationId}` },
    create: { key: `${CLAVE}${conversationId}`, value },
    update: { value },
  });
}
