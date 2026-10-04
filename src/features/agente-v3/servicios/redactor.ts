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
 */
export async function responderConElRedactor(input: {
  workspaceId: string;
  conversationId: string;
  guia?: string | null;
  foto?: string | null;
  enviarTexto: (texto: string) => Promise<boolean>;
  avisarAsesor: (motivo: string) => Promise<void>;
  yaLoDijimos: (texto: string) => Promise<boolean>;
}): Promise<string> {
  const resultado = await generarSugerenciaDeRespuesta({
    workspaceId: input.workspaceId,
    fuente: "agent",
    conversationId: input.conversationId,
    guia: input.guia ?? null,
    foto: input.foto ?? null,
    // El agente no manda flujos por su cuenta desde aca: eso lo deciden las reglas del libro.
    conFlujos: false,
  }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));

  if ("error" in resultado) {
    await input.avisarAsesor("El agente no pudo redactar una respuesta: que conteste una persona");
    return `El redactor no pudo responder (${resultado.error}): se avisó a una asesora.`;
  }

  if (resultado.problemas.length > 0) {
    await input.avisarAsesor("El agente no pudo responder sin inventar un dato: que conteste una persona");
    console.warn("[agente-v3] redactor sin enviar", { conversationId: input.conversationId, problemas: resultado.problemas });
    return `El redactor no envió nada porque su texto no cumplía: ${resultado.problemas.join("; ")}. Se avisó a una asesora.`;
  }

  if (await input.yaLoDijimos(resultado.texto)) {
    await input.avisarAsesor("El agente iba a repetir un mensaje que ya envió: que conteste una persona");
    return "El redactor iba a repetir un mensaje ya enviado: se avisó a una asesora.";
  }

  const salio = await input.enviarTexto(resultado.texto);
  if (!salio) {
    await input.avisarAsesor("El agente no pudo enviar su respuesta: que conteste una persona");
    return "El mensaje del redactor no salió: se avisó a una asesora.";
  }

  if (resultado.faltaDato) {
    await input.avisarAsesor("La clienta preguntó un dato que no está en el libro y el agente le dijo que se lo confirmamos");
    return "Respondió el redactor y, como faltaba un dato, avisó a una asesora para confirmarlo.";
  }
  return "Respondió el redactor: ninguna regla del libro aplicaba.";
}
