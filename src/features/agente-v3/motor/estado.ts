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
    seguimientosEnviados: [],
    avisoDePausaEnviado: false,
  };
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE}${conversationId}` } });
  if (!fila?.value) {
    /*
      Sin estado guardado NO significa que sea el primer mensaje de la conversación.

      Significa que el agente todavía no ha atendido a nadie ahí. Es distinto: un chat que abrimos
      NOSOTROS -una campaña, una asesora escribiendo primero- ya tiene historia cuando el cliente
      por fin contesta.

      Pasó tal cual: le escribimos a las 17:42 con fotos y precio, salieron los dos seguimientos, y
      cuando ella contestó a las 19:49 el agente le mandó la BIENVENIDA como si acabara de llegar,
      dos horas y tres mensajes después (Alex, 25-09-2026).

      Así que se mira lo único que de verdad responde la pregunta: ¿ya le dijimos algo a esta
      persona? Si sí, no es un primer mensaje y no va el saludo.
    */
    const yaLeHablamos = await prisma.message.count({
      where: { conversationId, direction: "OUTBOUND", type: { not: "SYSTEM" } },
    });
    return { ...vacio, esPrimerMensaje: yaLeHablamos === 0 };
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
      seguimientosEnviados: Array.isArray(guardado.seguimientosEnviados)
        ? guardado.seguimientosEnviados.filter((minutos): minutos is number => typeof minutos === "number")
        : [],
      avisoDePausaEnviado: guardado.avisoDePausaEnviado === true,
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
    seguimientosEnviados: estado.seguimientosEnviados ?? [],
    avisoDePausaEnviado: estado.avisoDePausaEnviado === true,
  });
  await prisma.appSetting.upsert({
    where: { key: `${CLAVE}${conversationId}` },
    create: { key: `${CLAVE}${conversationId}`, value },
    update: { value },
  });
}
