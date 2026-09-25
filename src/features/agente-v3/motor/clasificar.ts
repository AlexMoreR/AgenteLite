import type { ReglaV3 } from "../domain/reglas";

/**
 * Qué intenciones reconoce la IA en un mensaje.
 *
 * Es el ÚNICO lugar donde la IA decide algo, y decide poco: se le dan las intenciones candidatas
 * escritas por el negocio y contesta cuáles encajan. No elige qué hacer, no redacta, no ve el
 * catálogo entero. Con eso, una respuesta rara se corrige cambiando una frase del libro y no
 * peleándole a un prompt de veinte mil caracteres.
 *
 * Si no hay clave de OpenAI, si la llamada falla o si tarda, devuelve vacío: el motor sigue con
 * las reglas por frase, que no necesitan IA. Un agente que se queda mudo porque la IA no contestó
 * es peor que uno que responde de más.
 */

const MODELO = "gpt-4.1-mini";
const PLAZO_MS = 8000;

export async function clasificarIntenciones(input: {
  mensaje: string;
  reglas: ReglaV3[];
  /** Los últimos mensajes, del más viejo al más nuevo: "si" o "el negro" no se entienden solos. */
  historial?: Array<{ de: "cliente" | "negocio"; texto: string }>;
  /**
   * El mensaje al que el cliente le respondió con "responder" de WhatsApp.
   *
   * Llega SOLO hasta acá, nunca al comparador de frases: pegado al mensaje, las palabras de
   * nuestro propio texto citado contarían como dichas por el cliente y dispararían reglas que
   * nadie pidió. Ya pasó una vez con las descripciones de las fotos.
   */
  citado?: string;
}): Promise<string[]> {
  const candidatas = input.reglas.filter((regla) => regla.activa && regla.cuando.tipo === "intencion");
  if (candidatas.length === 0) {
    return [];
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return [];
  }

  const lista = candidatas
    .map((regla) => `- ${regla.id}: ${regla.cuando.tipo === "intencion" ? regla.cuando.descripcion : ""}`)
    .join("\n");

  const contexto = (input.historial ?? [])
    .slice(-6)
    .map((linea) => `${linea.de === "cliente" ? "Cliente" : "Negocio"}: ${linea.texto}`)
    .join("\n");

  try {
    const respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(PLAZO_MS),
      body: JSON.stringify({
        model: MODELO,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Sos un clasificador. Te doy intenciones posibles y el ultimo mensaje de un cliente de WhatsApp. " +
              "Devolves SOLO un JSON {\"ids\":[...]} con los ids de las intenciones que de verdad encajan con ese " +
              "mensaje. Si ninguna encaja, devolves {\"ids\":[]}. No inventes ids. Ante la duda, no la incluyas: " +
              "es preferible que el agente no haga nada a que haga lo que no le pidieron.",
          },
          {
            role: "user",
            content:
              `Intenciones:
${lista}

Conversacion previa:
${contexto || "(no hay)"}

` +
              (input.citado
                ? `El cliente esta RESPONDIENDO a este mensaje nuestro:
"${input.citado.slice(0, 300)}"

`
                : "") +
              `Ultimo mensaje del cliente:
${input.mensaje}`,
          },
        ],
      }),
    });

    if (!respuesta.ok) {
      return [];
    }
    const datos = (await respuesta.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const crudo = datos.choices?.[0]?.message?.content?.trim();
    if (!crudo) {
      return [];
    }
    const parseado = JSON.parse(crudo) as { ids?: unknown };
    const ids = Array.isArray(parseado.ids) ? parseado.ids.filter((id): id is string => typeof id === "string") : [];
    // Solo ids que existan de verdad: el modelo a veces devuelve uno inventado.
    const conocidas = new Set(candidatas.map((regla) => regla.id));
    return ids.filter((id) => conocidas.has(id));
  } catch {
    return [];
  }
}
