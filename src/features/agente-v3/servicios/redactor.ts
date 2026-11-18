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
 * Si la IA falla (error, tiempo de espera, respuesta vacia), el texto rompe una regla o iba a
 * repetir un mensaje, la clienta no recibe nada de aca: el redactor NO avisa por su cuenta y
 * devuelve `falla` para que el motor le mande el mensaje de respaldo y recien ahi avise a la
 * asesora con la causa (Alex, 12-11-2026: dos clientas quedaron sin respuesta).
 */
export type ResultadoDelRedactor = {
  /** Para la nota del chat y el registro. */
  porque: string;
  /** La clienta recibio el texto del redactor. */
  respondio: boolean;
  /** Por que no respondio: "tiempo de espera", "la IA respondió 429", "filtro"... (null si respondio). */
  causa: string | null;
  /**
   * Falto el texto por la IA: quien llama manda el respaldo, avisa con este motivo y, si `pausar`,
   * pausa la IA DESPUES del respaldo. Sin `falla` (respondio, o fallo el envio por WhatsApp) no hay
   * respaldo: el aviso, si hacia falta, ya salio.
   */
  falla?: { motivo: string; pausar: boolean };
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
  }).catch((error) => ({ error: error instanceof Error ? error.message : String(error), causa: "error inesperado" }));

  if ("error" in resultado) {
    // La causa de la IA si la hay; si no, el error (sin configurar, chat sin mensajes...).
    const causa = resultado.causa ?? resultado.error;
    console.warn("[agente-v3] redactor sin texto", { conversationId: input.conversationId, causa });
    return {
      porque: `El redactor no pudo responder (${causa}).`,
      respondio: false,
      causa,
      falla: { motivo: `El agente no pudo redactar una respuesta (${causa})`, pausar: false },
    };
  }

  if (resultado.problemas.length > 0) {
    console.warn("[agente-v3] redactor sin enviar", { conversationId: input.conversationId, problemas: resultado.problemas });
    return {
      porque: `El redactor no envió nada porque su texto no cumplía: ${resultado.problemas.join("; ")}.`,
      respondio: false,
      causa: "el texto rompía una regla",
      falla: { motivo: "El agente no pudo responder sin inventar un dato (el texto rompía una regla)", pausar: true },
    };
  }

  if (await input.yaLoDijimos(resultado.texto)) {
    return {
      porque: "El redactor iba a repetir un mensaje ya enviado.",
      respondio: false,
      causa: "iba a repetir un mensaje ya enviado",
      falla: { motivo: "El agente no pudo redactar algo nuevo (iba a repetir un mensaje ya enviado)", pausar: false },
    };
  }

  const salio = await input.enviarTexto(resultado.texto);
  if (!salio) {
    // Fallo WhatsApp, no la IA: otro envio probablemente tambien fallaria. Solo el aviso, como siempre.
    await input.avisarAsesor("El agente no pudo enviar su respuesta: que conteste una persona");
    return { porque: "El mensaje del redactor no salió: se avisó a una asesora.", respondio: false, causa: "falló el envío por WhatsApp" };
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
