import { generarSugerenciaDeRespuesta } from "@/lib/sugerencia-de-respuesta";

/**
 * EL REDACTOR DEL AGENTE V3: lo que no esta en el libro lo contesta el redactor de la estrella.
 *
 * Pedido de Alex (03-10-2026): antes, si ninguna regla encajaba, el mensaje quedaba sin respuesta
 * hasta que entrara una asesora. Ahora lo contesta la misma IA que le sugiere textos a las
 * vendedoras, con sus mismos candados, y como aca NO hay una persona revisando antes de enviar,
 * se agregan dos mas:
 *  - Si el texto final todavia rompe una regla (inventa un precio, un plazo, menciona mayorista),
 *    NO se envia: se avisa a una asesora.
 *  - Si el texto dice que se va a confirmar un dato que no tenemos (envio a una ciudad, tiempos),
 *    se envia y ademas se avisa a una asesora para que lo confirme de verdad.
 * Y nunca repite un mensaje que ya salio en el chat.
 *
 * Tambien es la accion "responder con IA" del libro: la regla le pasa su guia.
 *
 * Devuelve por que hizo lo que hizo (`porque`, para el log del motor), si a la clienta le llego un
 * mensaje (`respondio`) y, si la IA no logro redactar, la causa ("tiempo de espera", "la IA
 * respondió 429", "fallo de conexión", "respuesta vacía"). La causa va tambien en la nota a la asesora.
 */
export type ResultadoDelRedactor = {
  porque: string;
  /** false si a la clienta no le salio nada: fallo la IA, el filtro freno el texto, iba a repetir o no se pudo enviar. */
  respondio: boolean;
  /** Por que no redacto, solo cuando el que fallo fue la IA (o lo que la rodea); si no, null. */
  causa: string | null;
};

export async function responderConElRedactor(input: {
  workspaceId: string;
  conversationId: string;
  guia?: string | null;
  foto?: string | null;
  enviarTexto: (texto: string) => Promise<boolean>;
  avisarAsesor: (motivo: string) => Promise<void>;
  yaLoDijimos: (texto: string) => Promise<boolean>;
  /**
   * Pausar la IA en esta conversación, igual que la acción `pausar_ia` del libro.
   *
   * Cuando el redactor le pasa la charla a una asesora porque falta un dato, el agente se calla
   * hasta que ella conteste (caso del 08-10-2026: avisó "falta un dato" y en el mensaje siguiente
   * contestó él solo el precio equivocado). Se despausa como siempre: a mano desde el chat.
   */
  pausarIa?: () => Promise<void>;
}): Promise<ResultadoDelRedactor> {
  const pasarAUnaAsesora = async (motivo: string) => {
    await input.avisarAsesor(motivo);
    await input.pausarIa?.().catch(() => {});
  };

  const resultado = await generarSugerenciaDeRespuesta({
    workspaceId: input.workspaceId,
    fuente: "agent",
    conversationId: input.conversationId,
    guia: input.guia ?? null,
    foto: input.foto ?? null,
    // El agente no manda flujos por su cuenta desde aca: eso lo deciden las reglas del libro.
    conFlujos: false,
  }).catch((error) => {
    console.warn("[agente-v3] el redactor fallo", { conversationId: input.conversationId, error: error instanceof Error ? error.message : String(error) });
    return { error: "error inesperado", causa: "error inesperado" };
  });

  if ("error" in resultado) {
    // Sin causa de la IA (no esta configurada, el chat no tiene mensajes...) se usa el error mismo.
    const causa = resultado.causa ?? resultado.error;
    await input.avisarAsesor(`El agente no pudo redactar una respuesta (${causa}): que conteste una persona`);
    return { porque: `El redactor no pudo responder (${causa}): se avisó a una asesora.`, respondio: false, causa };
  }

  if (resultado.problemas.length > 0) {
    await pasarAUnaAsesora("El agente no pudo responder sin inventar un dato: que conteste una persona");
    console.warn("[agente-v3] redactor sin enviar", { conversationId: input.conversationId, problemas: resultado.problemas });
    return {
      porque: `El redactor no envió nada porque su texto no cumplía: ${resultado.problemas.join("; ")}. Se avisó a una asesora y se pausó la IA.`,
      respondio: false,
      causa: null,
    };
  }

  if (await input.yaLoDijimos(resultado.texto)) {
    await input.avisarAsesor("El agente iba a repetir un mensaje que ya envió: que conteste una persona");
    return { porque: "El redactor iba a repetir un mensaje ya enviado: se avisó a una asesora.", respondio: false, causa: null };
  }

  const salio = await input.enviarTexto(resultado.texto);
  if (!salio) {
    await input.avisarAsesor("El agente no pudo enviar su respuesta: que conteste una persona");
    return { porque: "El mensaje del redactor no salió: se avisó a una asesora.", respondio: false, causa: null };
  }

  if (resultado.faltaDato) {
    await pasarAUnaAsesora("La clienta preguntó un dato que no está en el libro y el agente le dijo que se lo confirmamos");
    return {
      porque: "Respondió el redactor y, como faltaba un dato, avisó a una asesora para confirmarlo y pausó la IA.",
      respondio: true,
      causa: null,
    };
  }
  return { porque: "Respondió el redactor: ninguna regla del libro aplicaba.", respondio: true, causa: null };
}
