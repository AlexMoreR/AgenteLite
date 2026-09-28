import { prisma } from "@/lib/prisma";

/**
 * LA HUELLA DE CADA VUELTA DEL MOTOR: "hasta acá ya miré, y esto decidí".
 *
 * Hasta ahora, cuando el agente decidía NO responder, no quedaba rastro en ningún lado: solo una
 * línea en el log del servidor, que se borra. Desde afuera, "el agente lo miró y no le tocaba
 * contestar" y "el agente nunca se enteró del mensaje" se veían exactamente igual.
 *
 * Esa diferencia es justo la condición que puso Alex para dejar que el rescate de mensajes exista
 * (28-09-2026): **si hubo decisión, aunque haya sido no responder, no se toca**. Sin esta marca
 * no se puede cumplir, porque no habría con qué distinguirlas.
 *
 * Se guarda la HORA de la decisión y no el id del mensaje: el motor trabaja por tandas —junta los
 * mensajes que llegan seguidos— así que lo que de verdad cubre una vuelta es "todo lo que había
 * hasta este momento". Cualquier mensaje anterior a `cuando` ya fue visto.
 */

const CLAVE = "agente-v3:decision:";

export type DecisionDelMotor = {
  /** Hasta cuándo miró esta vuelta. Todo mensaje anterior ya fue evaluado. */
  cuando: string;
  atendido: boolean;
  regla: string | null;
};

export async function leerUltimaDecision(conversationId: string): Promise<DecisionDelMotor | null> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE}${conversationId}` } });
  if (!fila?.value) {
    return null;
  }
  try {
    const guardado = JSON.parse(fila.value) as Partial<DecisionDelMotor>;
    if (typeof guardado.cuando !== "string") {
      return null;
    }
    return {
      cuando: guardado.cuando,
      atendido: guardado.atendido === true,
      regla: typeof guardado.regla === "string" ? guardado.regla : null,
    };
  } catch {
    return null;
  }
}

/** Nunca lanza: una huella que falla no puede tumbar la respuesta al cliente. */
export async function anotarDecision(conversationId: string, decision: DecisionDelMotor): Promise<void> {
  const key = `${CLAVE}${conversationId}`;
  const value = JSON.stringify(decision);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } }).catch(() => {});
}
