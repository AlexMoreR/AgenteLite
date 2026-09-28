/**
 * EL TEXTO DE UN SEGUIMIENTO INTELIGENTE, escrito leyendo la conversación entera.
 *
 * Los seguimientos del libro son textos fijos atados a un paso del embudo, y funcionan bien
 * mientras el agente lleva la charla. El problema aparece después: cuando el agente manda las
 * fotos, avisa a la asesora y la asesora contesta, la conversación se sale del embudo y ya no hay
 * ningún texto fijo que corresponda. Esos chats se quedaban sin un solo seguimiento (Alex,
 * 27-09-2026).
 *
 * Acá la IA sí redacta, que es la única parte del V3 donde eso pasa. Se le da la conversación
 * completa y la voz del negocio, y se le pide UN mensaje para retomar. Lo que NO se le da es
 * libertad: no puede inventar precios ni plazos, no puede repetir lo ya dicho, y puede decir que
 * mejor no se escriba nada.
 *
 * Si la IA falla, tarda o no está configurada, devuelve null y NO se manda nada. Es a propósito:
 * un seguimiento inventado a un cliente real cuesta más caro que un seguimiento que no salió.
 */

const MODELO = "gpt-4.1-mini";
const PLAZO_MS = 15000;

/** Cuánta conversación se le pasa. Suficiente para entender la charla sin mandar una novela. */
const MAXIMO_DE_MENSAJES = 40;
const MAXIMO_POR_MENSAJE = 300;

/** Un seguimiento más largo que esto no lo lee nadie en WhatsApp. */
const MAXIMO_DEL_TEXTO = 400;

export type LineaDeCharla = { de: "cliente" | "negocio"; texto: string };

export type SeguimientoRedactado = {
  /**
   * La charla ya está cerrada: el cliente compró, se fue, o pidió que no lo contacten.
   *
   * Se devuelve aparte de `texto` porque no significa lo mismo que un fallo. Un fallo se reintenta
   * en el siguiente escalón; un cerrado termina la cadena para siempre. Probado: con la charla de
   * un cliente que ya transfirió, el modelo contesta "cerrado" a los 15 minutos, a la hora y al
   * día, y al tercer día se le escapa y redacta igual. Basta con que lo acierte una vez.
   */
  cerrado: boolean;
  /** El texto a enviar, o null si no hay que escribir nada. */
  texto: string | null;
};

const NO_ESCRIBIR: SeguimientoRedactado = { cerrado: false, texto: null };

/** Cómo cambia el tono según cuánto lleva callado. No es lo mismo a los 15 minutos que a 3 días. */
const TONO_POR_ESCALON: Record<number, string> = {
  15: "Pasaron 15 minutos. Recordatorio corto, casi una continuación de lo último que se dijo. Si quedó una pregunta nuestra pendiente, se repite esa pregunta de otra forma. No suena a insistencia.",
  60: "Pasó una hora. Se retoma con naturalidad y se ofrece resolver la duda que haya quedado, sin repetir lo ya explicado.",
  1440:
    "Pasó un día. Se nota que se retoma después de un rato: se le recuerda en una línea qué estaba mirando y se le pregunta si sigue interesado.",
  4320:
    "Pasaron 3 días. Es el último intento. Se pregunta de frente si quiere seguir o si prefiere dejarlo para más adelante, sin presionar ni sonar molesto.",
};

export async function redactarSeguimiento(input: {
  /** Del más viejo al más nuevo. */
  historial: LineaDeCharla[];
  /** Minutos que lleva callado el chat: 15, 60, 1440 o 4320. */
  escalon: number;
  /** El bloque "cómo hablamos" del libro: la voz y los datos fijos del negocio. */
  comoHablamos: string;
  nombreDelCliente?: string | null;
}): Promise<SeguimientoRedactado> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NO_ESCRIBIR;
  }

  const charla = input.historial
    .slice(-MAXIMO_DE_MENSAJES)
    .filter((linea) => linea.texto.trim())
    .map((linea) => `${linea.de === "cliente" ? "Cliente" : "Nosotros"}: ${linea.texto.slice(0, MAXIMO_POR_MENSAJE)}`)
    .join("\n");

  if (!charla.trim()) {
    return NO_ESCRIBIR;
  }

  const tono = TONO_POR_ESCALON[input.escalon] ?? TONO_POR_ESCALON[1440];

  try {
    const respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(PLAZO_MS),
      body: JSON.stringify({
        model: MODELO,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "Escribes los mensajes de seguimiento de WhatsApp de un negocio COLOMBIANO que vende muebles para salones de belleza.",
              "Te doy la conversación completa con un cliente que se quedó callado. Escribes UN solo mensaje para retomarla.",
              "",
              "ESPAÑOL DE COLOMBIA, tuteo: 'quieres', 'tienes', 'prefieres', 'te comparto'.",
              "PROHIBIDO el voseo argentino: nunca 'querés', 'tenés', 'preferís', 'podés', 'mirá', 'contame'.",
              "",
              "Reglas que no se rompen:",
              "- NO inventes precios, medidas, plazos de entrega, fechas, promociones, stock ni políticas. Si un dato no está en la conversación ni en la información del negocio, no lo menciones. Nunca ofrezcas confirmar una fecha de entrega.",
              "- NO repitas un mensaje que ya se envió ni vuelvas a explicar algo ya explicado.",
              "- NO saludes como si fuera el primer mensaje: la conversación ya viene andando.",
              "- Si quedó una pregunta NUESTRA sin responder (el color, la ciudad, qué servicios ofrece), el seguimiento vuelve sobre ESA pregunta y no sobre otra cosa.",
              "- Si sabes su nombre, úsalo una vez.",
              "- Un solo mensaje, máximo 300 caracteres, y termina con UNA pregunta que le facilite contestar.",
              "- Negrita de WhatsApp con un solo asterisco (*así*), nunca doble.",
              "",
              "Devuelves SOLO un JSON con dos campos:",
              '{"cerrado": true|false, "mensaje": "el texto"}',
              "",
              "- cerrado: true si el cliente YA COMPRÓ (pagó, transfirió, mandó el soporte, apartó el pedido, o su pedido ya está en fabricación), si dijo que no le interesa, si compró en otro lado, si pidió que no lo contacten, o si la conversación quedó cerrada con un acuerdo.",
              "- mensaje: el seguimiento. Escríbelo siempre, aunque cerrado sea true; quien decide si sale es el sistema, no tú.",
              "",
              "`cerrado` sale de la CONVERSACIÓN y nada más. No depende de cuánto tiempo pasó: si el cliente ya pagó,",
              "es true a los 15 minutos y sigue siendo true a los 3 días. Es el campo que evita que le escribamos a",
              "alguien que ya compró, así que contéstalo sin suavizarlo.",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              "INFORMACIÓN DEL NEGOCIO (para el tono y para no inventar):",
              input.comoHablamos.slice(0, 6000),
              "",
              "CONVERSACIÓN COMPLETA:",
              charla,
              "",
              input.nombreDelCliente ? `El cliente se llama: ${input.nombreDelCliente}` : "No sabemos su nombre.",
              "",
              `SITUACIÓN: ${tono}`,
            ].join("\n"),
          },
        ],
      }),
    });

    if (!respuesta.ok) {
      return NO_ESCRIBIR;
    }

    const datos = (await respuesta.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const crudo = datos.choices?.[0]?.message?.content?.trim();
    if (!crudo) {
      return NO_ESCRIBIR;
    }

    const parseado = JSON.parse(crudo) as { mensaje?: unknown; cerrado?: unknown };

    /*
      La decisión de callarse la toma el código, no el modelo.

      Primero se le pedía que devolviera el mensaje en null cuando no correspondía escribir, y no lo
      hacía: probado con una charla donde el cliente ya había transferido, igual redactaba un
      seguimiento en los cuatro escalones. Un modelo contesta bien una pregunta directa ("¿ya
      compró?") y mal una que le pide no hacer lo que se le acaba de pedir que haga.

      Y se le pregunta UNA sola cosa. Con dos banderas -se le preguntaba también si el cliente
      quedó esperando respuesta- decía que sí en todas las charlas, incluso en las que el último
      mensaje era nuestro. Eso ya lo sabe el código: acá solo se llega cuando hablamos nosotros al
      final.
    */
    if (parseado.cerrado === true) {
      return { cerrado: true, texto: null };
    }

    if (typeof parseado.mensaje !== "string") {
      return NO_ESCRIBIR;
    }

    const texto = parseado.mensaje.trim();
    if (!texto || texto.length > MAXIMO_DEL_TEXTO) {
      return NO_ESCRIBIR;
    }
    return { cerrado: false, texto };
  } catch {
    return NO_ESCRIBIR;
  }
}
