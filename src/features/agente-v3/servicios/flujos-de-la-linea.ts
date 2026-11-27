import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import type { ResultadoDelRedactor } from "../motor/ejecutar";

/**
 * Busca, entre los flujos de UNA línea de WhatsApp, el de título exactamente igual a `titulo`
 * (por ejemplo la "Ficha Camilla Divan" del respaldo). Nunca toma flujos de otra línea: el id de
 * los flujos de Evolution empieza por `evolution:<channelId>:`. Devuelve el id o null; si la
 * consulta falla, devuelve null y deja un aviso (el motor manda entonces el texto corto).
 */
export async function buscarFlujoDeLaLinea(input: {
  workspaceId: string;
  channelId: string;
  titulo: string;
}): Promise<string | null> {
  try {
    const flujos = await getCreatedFlowItems({ workspaceId: input.workspaceId, includeOfficialApi: false });
    const prefijo = `evolution:${input.channelId}:`;
    const encontrado = flujos.find((flujo) => flujo.id.startsWith(prefijo) && flujo.title === input.titulo);
    return encontrado?.id ?? null;
  } catch (error) {
    console.warn("[agente-v3] buscarFlujo", {
      titulo: input.titulo,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Qué le devuelven las herramientas al motor después de llamar al redactor. Si la IA falló por una
 * causa (tiempo de espera, respuesta vacía o error), se devuelve el resultado completo para que el
 * motor mande el respaldo. En cualquier otro caso (envío fallido, IA pausada, texto que rompía una
 * regla, mensaje repetido o sí respondió) queda como antes: el texto en modo sinRegla y nada en conIa.
 */
export function resultadoParaElMotor(resultado: ResultadoDelRedactor, modo: "conIa"): ResultadoDelRedactor | undefined;
export function resultadoParaElMotor(resultado: ResultadoDelRedactor, modo: "sinRegla"): ResultadoDelRedactor | string;
export function resultadoParaElMotor(
  resultado: ResultadoDelRedactor,
  modo: "conIa" | "sinRegla",
): ResultadoDelRedactor | string | undefined {
  if (resultado.respondio === false && resultado.causa !== null) return resultado;
  return modo === "sinRegla" ? resultado.porque : undefined;
}
