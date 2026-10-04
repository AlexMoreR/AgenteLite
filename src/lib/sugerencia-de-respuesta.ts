import { prisma } from "@/lib/prisma";
import type { ActiveProductContext } from "@/lib/agent-product-flow";
import { esNotaInternaDelAgente } from "@/lib/notas-internas-del-agente";
import { leerLibro } from "@/features/agente-v3/servicios/almacen";
import { flujosParaSugerir, mismaDireccion, type FlujoParaSugerir } from "@/lib/flujos-para-sugerir";

/**
 * La estrella ✨ del cuadro de mensajes: le redacta a la vendedora una respuesta para ESTE chat.
 *
 * Nunca envia nada: el texto se escribe en la caja y ella lo edita, lo manda o lo borra. Si un
 * flujo sirve mas que un texto (duda de calidad -> el video del combo armado), lo propone como un
 * boton aparte, que tambien hay que tocar.
 *
 * Que lee (Alex, 03-10-2026):
 *  - Los ultimos 20 mensajes, con el texto de las notas de voz (el reloj del servidor transcribe
 *    las de la clienta y las nuestras al minuto de llegar).
 *  - Hace cuanto escribio la clienta y quien escribio ultimo: no es lo mismo contestarle a alguien
 *    que escribio hace 2 minutos que a alguien callada hace 3 dias.
 *  - Que fotos, videos, documentos y flujos ya se le enviaron, para no repetirlos.
 *  - El producto activo con su descripcion para el agente, y el texto "Como hablamos" del libro del
 *    V3 (fuente de las formas de pago y los datos fijos).
 *
 * Las reglas de Alex se COMPRUEBAN en el texto que sale -largo, una sola pregunta, nada inventado,
 * nada repetido- y si algo no cumple se le devuelve al modelo con el detalle.
 */

const MODELO = "gpt-4.1-mini";
const PLAZO_MS = 25_000;
const MENSAJES_DE_CONTEXTO = 20;
/** "Unas 35 palabras": con esto de margen se acepta; mas, se pide recortar. */
const PALABRAS_MAXIMAS = 42;

const PESOS = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

const REGLAS = `REGLAS DE LA RESPUESTA (todas obligatorias):
- Máximo 2 frases cortas, unas 35 palabras en total. Un solo bloque, sin saltos de línea ni párrafos.
- UNA sola pregunta, al final, que haga avanzar la venta. Nunca dos preguntas.
- Responde a lo ÚLTIMO que escribió la clienta. No repitas lo que ya se le dijo en la conversación (precio, fotos, garantía, formas de pago): si ya lo sabe, avanza.
- La garantía y la fabricación personalizada SOLO si la clienta pregunta por calidad, materiales o confianza.
- Español de Colombia. Tutea (tú, nunca vos ni usted).
- Si hablas de precio, envío o pago, con el valor exacto. Si es la primera vez que se habla de pago, menciona las dos formas (anticipo 50% con envío gratis a ciudades principales, o contraentrega pagando solo el envío antes) en una sola frase.
- Nunca escribas la palabra "pero" (usa "sin embargo"), ni "¿sigues interesada?", ni "cuando puedas me avisas".
- No inventes precios, medidas, materiales ni tiempos. El valor del envío a una ciudad y los tiempos de fabricación o entrega NO están en los datos: di que se los confirmas.
- Nunca ofrezcas ni menciones precio al por mayor ni descuentos.
- Negrita de WhatsApp con UN solo asterisco (*así*), nunca doble. Sin saludo si la conversación ya empezó, y sin firma.`;

const REGLAS_DEL_FLUJO = `FLUJOS: si mandar uno de estos flujos sirve más que un texto, elígelo (por ejemplo: duda de calidad o de confianza, o pide verlo armado o en uso → el video del producto armado; pide el catálogo → el catálogo). Nunca uno que ya se envió en este chat. Si eliges un flujo, el texto lo presenta como algo que le estás enviando ahora mismo ("Te comparto el video del combo armado"), sin preguntarle si lo quiere y sin describir lo que trae; la pregunta del final va sobre otra cosa que avance la venta. Si ninguno sirve más que un texto, no elijas ninguno.`;

const FORMATO = `Responde SOLO un JSON: {"texto": "<el mensaje>", "flujo_id": "<id del flujo o null>"}`;

export type Linea = { de: "cliente" | "negocio"; texto: string; en: Date };

export type FlujoSugerido = { id: string; titulo: string };

export type SugerenciaGenerada =
  | { texto: string; productoId: string | null; flujo: FlujoSugerido | null }
  | { error: string };

export async function generarSugerenciaDeRespuesta(input: {
  workspaceId: string;
  fuente: "agent" | "official";
  conversationId: string;
}): Promise<SugerenciaGenerada> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { error: "La IA no está configurada" };
  }

  const chat = await leerChat(input);
  if (!chat) {
    return { error: "Conversación no encontrada" };
  }
  if (chat.lineas.length === 0) {
    return { error: "Todavía no hay mensajes para sugerir una respuesta" };
  }

  const [producto, libro, todosLosFlujos] = await Promise.all([
    leerProducto(input.workspaceId, chat.productoId),
    leerLibro(input.workspaceId).catch(() => null),
    flujosParaSugerir(input.workspaceId),
  ]);

  // Solo los flujos del canal de ESTE chat: un flujo de otra linea no se puede mandar desde aca.
  const origenDelChat = input.fuente === "official" ? "official-api:" : `evolution:${chat.channelId ?? ""}`;
  const flujos = todosLosFlujos.filter((flujo) =>
    input.fuente === "official" ? flujo.origen.startsWith(origenDelChat) : flujo.origen === origenDelChat,
  );

  const resultado = await redactarSugerencia({
    apiKey,
    comoHablamos: libro?.comoHablamos?.trim() || "",
    producto,
    lineas: chat.lineas,
    enviado: resumirLoEnviado(chat.archivosEnviados, flujos),
    flujos,
    ahora: new Date(),
  });
  if (!resultado) {
    return { error: "No se pudo generar la sugerencia. Inténtalo de nuevo." };
  }
  return { texto: resultado.texto, productoId: producto?.id ?? null, flujo: resultado.flujo };
}

export type ProductoParaSugerir = {
  id: string;
  nombre: string;
  codigo: string | null;
  precio: string;
  descripcion: string | null;
  precioMayorista: number | null;
};

export type LoEnviado = {
  /** "3 fotos, 1 video, documentos: COMBO DE CAMILLAS.pdf". */
  resumen: string;
  /** Ids de flujos que ya llegaron a este chat. */
  flujosEnviados: Set<string>;
};

/** La redaccion pura, sin base: prompt, comprobacion de reglas, hasta dos correcciones y arreglos finales. */
export async function redactarSugerencia(input: {
  apiKey: string;
  comoHablamos: string;
  producto: ProductoParaSugerir | null;
  lineas: Linea[];
  enviado: LoEnviado;
  flujos: FlujoParaSugerir[];
  ahora: Date;
}): Promise<{ texto: string; flujo: FlujoSugerido | null } | null> {
  const { apiKey, comoHablamos, producto, lineas, enviado } = input;
  const flujosDisponibles = input.flujos.filter((flujo) => !enviado.flujosEnviados.has(flujo.id));

  const sistema = [
    "Eres una vendedora experta de Magilus que le escribe por WhatsApp a una clienta. Redactas la PRÓXIMA respuesta de la vendedora en esta conversación.",
    REGLAS,
    comoHablamos ? `DATOS DEL NEGOCIO Y FORMA DE HABLAR (fuente de verdad: precios, pagos, envíos, materiales):\n${comoHablamos}` : "",
    producto
      ? `PRODUCTO DEL QUE SE ESTÁ HABLANDO:\n*${producto.nombre}*${producto.codigo ? ` (${producto.codigo})` : ""}\nPrecio: ${producto.precio}\n${producto.descripcion ? `Descripción para el agente:\n${producto.descripcion}` : "Sin descripción: no inventes características."}`
      : "No hay un producto identificado en esta conversación: si la clienta pregunta por uno, pregunta cuál, sin inventar precios.",
    flujosDisponibles.length > 0
      ? `${REGLAS_DEL_FLUJO}\nFlujos disponibles (id | nombre | para qué):\n${flujosDisponibles.map((flujo) => `- ${flujo.id} | ${flujo.titulo}${flujo.paraQue ? ` | ${flujo.paraQue}` : ""}`).join("\n")}`
      : "",
    FORMATO,
  ]
    .filter(Boolean)
    .join("\n\n");

  const conversacion = lineas
    .map((linea) => `[${haceCuanto(linea.en, input.ahora)}] ${linea.de === "cliente" ? "Clienta" : "Vendedora"}: ${linea.texto}`)
    .join("\n");

  const pedido = [
    `Conversación (de la más vieja a la más nueva, con hace cuánto se escribió cada mensaje):\n${conversacion}`,
    `Ya se le envió en este chat: ${enviado.resumen || "nada aparte de texto"}.`,
    situacion(lineas, input.ahora),
    "Escribe la próxima respuesta de la vendedora.",
  ].join("\n\n");

  let respuesta = await pedirAlModelo(apiKey, sistema, [{ role: "user", content: pedido }]);
  if (!respuesta) {
    return null;
  }
  let borrador = leerRespuesta(respuesta, flujosDisponibles);

  /*
    Las reglas se COMPRUEBAN: si algo no cumple, se le devuelve al modelo con el detalle, hasta dos
    veces. El contexto es todo lo que la sugerencia puede citar: un precio, un plazo o una medida que
    no este ahi es inventado (probando salio "envio aproximado de $120.000" y "7 a 10 dias habiles").
  */
  const contexto = [sistema, conversacion].join("\n");
  const ultimoDeLaClienta = [...lineas].reverse().find((linea) => linea.de === "cliente")?.texto ?? "";
  const nuestros = lineas.filter((linea) => linea.de === "negocio").map((linea) => linea.texto).join("\n");
  const revisar = (texto: string) =>
    problemasDeLaSugerencia(texto, {
      precioMayorista: producto?.precioMayorista ?? null,
      contexto,
      ultimoDeLaClienta,
      yaDijimos: nuestros,
    });

  for (let intento = 0; intento < 2; intento += 1) {
    const problemas = revisar(borrador.texto);
    if (problemas.length === 0) break;
    const corregida = await pedirAlModelo(apiKey, sistema, [
      { role: "user", content: pedido },
      { role: "assistant", content: respuesta },
      {
        role: "user",
        content: `Ese mensaje no cumple estas reglas:\n${problemas.map((p) => `- ${p}`).join("\n")}\n\nReescríbelo cumpliéndolas todas. ${FORMATO}`,
      },
    ]);
    if (!corregida) break;
    respuesta = corregida;
    const nuevo = leerRespuesta(corregida, flujosDisponibles);
    borrador = { texto: nuevo.texto || borrador.texto, flujo: nuevo.flujo ?? borrador.flujo };
  }

  const texto = ultimosArreglos(borrador.texto);
  return texto ? { texto, flujo: borrador.flujo } : null;
}

async function leerChat(input: { workspaceId: string; fuente: "agent" | "official"; conversationId: string }) {
  if (input.fuente === "official") {
    const chat = await prisma.officialApiConversation.findFirst({
      where: { id: input.conversationId, config: { workspaceId: input.workspaceId } },
      select: {
        activeProductContext: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: MENSAJES_DE_CONTEXTO,
          select: { direction: true, type: true, content: true, createdAt: true },
        },
      },
    });
    if (!chat) return null;
    const enviados = await prisma.officialApiMessage.findMany({
      where: { conversationId: input.conversationId, direction: "OUTBOUND", mediaUrl: { not: null } },
      select: { type: true, mediaUrl: true, content: true },
      take: 300,
    });
    return {
      productoId: idDelProducto(chat.activeProductContext),
      channelId: null as string | null,
      lineas: aLineas(chat.messages.map((m) => ({ ...m, transcripcion: null }))),
      archivosEnviados: enviados,
    };
  }

  const chat = await prisma.conversation.findFirst({
    where: { id: input.conversationId, workspaceId: input.workspaceId },
    select: {
      activeProductContext: true,
      channelId: true,
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: MENSAJES_DE_CONTEXTO,
        select: { direction: true, type: true, content: true, transcripcion: true, createdAt: true },
      },
    },
  });
  if (!chat) return null;
  const enviados = await prisma.message.findMany({
    where: { conversationId: input.conversationId, direction: "OUTBOUND", mediaUrl: { not: null }, deletedAt: null },
    select: { type: true, mediaUrl: true, content: true },
    take: 300,
  });
  return {
    productoId: idDelProducto(chat.activeProductContext),
    channelId: chat.channelId,
    lineas: aLineas(chat.messages),
    archivosEnviados: enviados,
  };
}

function idDelProducto(contexto: unknown) {
  const id = (contexto as ActiveProductContext | null | undefined)?.productId;
  return typeof id === "string" && id ? id : null;
}

/** Los mensajes, en orden, como los leeria una persona. Sin avisos del sistema ni notas internas. */
function aLineas(
  mensajes: Array<{ direction: string; type: string; content: string | null; transcripcion: string | null; createdAt: Date }>,
): Linea[] {
  return [...mensajes]
    .reverse()
    .filter((m) => m.type !== "SYSTEM" && !esNotaInternaDelAgente(m))
    .map((m) => {
      const contenido = m.content?.trim() || "";
      const texto =
        m.type === "AUDIO"
          ? m.transcripcion?.trim()
            ? `[nota de voz] ${m.transcripcion.trim()}`
            : "[nota de voz sin transcribir todavía]"
          : m.type === "IMAGE"
            ? `[foto]${contenido ? ` ${contenido}` : ""}`
            : m.type === "VIDEO"
              ? `[video]${contenido ? ` ${contenido}` : ""}`
              : m.type === "DOCUMENT"
                ? `[documento]${contenido ? ` ${contenido}` : ""}`
                : contenido;
      return {
        de: m.direction === "INBOUND" ? ("cliente" as const) : ("negocio" as const),
        texto: texto.slice(0, 800),
        en: m.createdAt,
      };
    })
    .filter((linea) => linea.texto);
}

function resumirLoEnviado(
  archivos: Array<{ type: string; mediaUrl: string | null; content: string | null }>,
  flujos: FlujoParaSugerir[],
): LoEnviado {
  const flujosEnviados = new Set<string>();
  for (const flujo of flujos) {
    if (flujo.archivos.some((url) => archivos.some((archivo) => archivo.mediaUrl && mismaDireccion(archivo.mediaUrl, url)))) {
      flujosEnviados.add(flujo.id);
    }
  }
  const cuantos = (tipo: string) => archivos.filter((archivo) => archivo.type === tipo).length;
  const documentos = [
    ...new Set(
      archivos
        .filter((archivo) => archivo.type === "DOCUMENT" && archivo.content?.trim())
        .map((archivo) => archivo.content!.trim().slice(0, 60)),
    ),
  ].slice(0, 8);
  const partes = [
    cuantos("IMAGE") ? `${cuantos("IMAGE")} fotos` : "",
    cuantos("VIDEO") ? `${cuantos("VIDEO")} videos` : "",
    documentos.length ? `documentos: ${documentos.join(", ")}` : "",
    flujosEnviados.size
      ? `flujos: ${flujos.filter((flujo) => flujosEnviados.has(flujo.id)).map((flujo) => `"${flujo.titulo}"`).join(", ")}`
      : "",
  ].filter(Boolean);
  return { resumen: partes.join("; "), flujosEnviados };
}

function haceCuanto(fecha: Date, ahora: Date) {
  const minutos = Math.max(0, Math.round((ahora.getTime() - new Date(fecha).getTime()) / 60_000));
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return `hace ${dias} ${dias === 1 ? "día" : "días"}`;
}

/**
 * La situacion en una linea, para que el modelo no tenga que deducirla: no es lo mismo contestarle a
 * quien acaba de escribir que retomar a quien lleva dias callada.
 */
function situacion(lineas: Linea[], ahora: Date) {
  const ultima = lineas[lineas.length - 1];
  const ultimoDeLaClienta = [...lineas].reverse().find((linea) => linea.de === "cliente");
  if (!ultima) return "";
  if (ultima.de === "cliente") {
    return `SITUACIÓN: la clienta escribió lo último, ${haceCuanto(ultima.en, ahora)}. Respóndele a eso directamente.`;
  }
  const horasCallada = ultimoDeLaClienta
    ? (ahora.getTime() - new Date(ultimoDeLaClienta.en).getTime()) / 3_600_000
    : Number.POSITIVE_INFINITY;
  if (horasCallada >= 24) {
    return `SITUACIÓN: la clienta no escribe desde ${ultimoDeLaClienta ? haceCuanto(ultimoDeLaClienta.en, ahora) : "el comienzo"} y lo último lo escribimos nosotros. Sugiere un seguimiento corto que aporte algo NUEVO (un dato, un flujo que no se le haya enviado, una pregunta distinta), sin repetir lo ya dicho y sin reclamarle que no contestó.`;
  }
  return `SITUACIÓN: lo último lo escribimos nosotros ${haceCuanto(ultima.en, ahora)} y la clienta escribió ${ultimoDeLaClienta ? haceCuanto(ultimoDeLaClienta.en, ahora) : "antes"}. Si falta algo por contestarle, hazlo; si no, una pregunta corta que avance.`;
}

async function leerProducto(workspaceId: string, productoId: string | null): Promise<ProductoParaSugerir | null> {
  if (!productoId) return null;
  const producto = await prisma.product
    .findFirst({
      where: { id: productoId, workspaceId },
      // A proposito SIN costo ni margenes. El mayorista se lee solo para comprobar que no se filtre.
      select: { id: true, name: true, code: true, price: true, description: true, wholesalePrice: true, activo: true },
    })
    .catch(() => null);
  if (!producto || !producto.activo) return null;
  const precioMayorista = Number(producto.wholesalePrice);
  return {
    id: producto.id,
    nombre: producto.name,
    codigo: producto.code,
    precio: PESOS.format(Number(producto.price)),
    descripcion: producto.description?.trim() || null,
    precioMayorista: precioMayorista > 0 ? precioMayorista : null,
  };
}

type MensajeDelModelo = { role: "user" | "assistant"; content: string };

async function pedirAlModelo(apiKey: string, sistema: string, mensajes: MensajeDelModelo[]) {
  try {
    const respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(PLAZO_MS),
      body: JSON.stringify({
        model: MODELO,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: sistema }, ...mensajes],
      }),
    });
    if (!respuesta.ok) {
      console.warn("[sugerencia] el modelo respondio", respuesta.status);
      return null;
    }
    const datos = (await respuesta.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return datos.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.warn("[sugerencia] fallo la llamada", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** El JSON del modelo: el texto con los arreglos seguros, y el flujo solo si existe y no se envio. */
function leerRespuesta(crudo: string, flujos: FlujoParaSugerir[]): { texto: string; flujo: FlujoSugerido | null } {
  let texto = "";
  let flujoId: unknown = null;
  try {
    const datos = JSON.parse(crudo) as { texto?: unknown; flujo_id?: unknown };
    texto = typeof datos.texto === "string" ? datos.texto : "";
    flujoId = datos.flujo_id;
  } catch {
    // Si no vino JSON, el texto entero es el mensaje.
    texto = crudo;
  }
  const flujo = typeof flujoId === "string" ? flujos.find((candidato) => candidato.id === flujoId) : undefined;
  return {
    texto: arreglosSeguros(texto.replace(/^["“]|["”]$/g, "")),
    flujo: flujo ? { id: flujo.id, titulo: flujo.titulo } : null,
  };
}

/** Arreglos que no cambian el sentido: negrita doble a simple, y todo en un solo bloque. */
function arreglosSeguros(texto: string) {
  return texto
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const TERMINA_EN_PREGUNTA = /\?[\s\p{Extended_Pictographic}‍️]*$/u;
const PREGUNTA_POR_PRECIO = /precio|cu[aá]nto|valor|vale|cuesta|cost/i;
const PREGUNTA_POR_CALIDAD = /calidad|garant|confi|material|dura|resist|segur|estafa|real|fabric|buen[ao]s?\b|aguanta|soporta/i;

export function problemasDeLaSugerencia(
  texto: string,
  datos: { precioMayorista: number | null; contexto: string; ultimoDeLaClienta: string; yaDijimos: string },
) {
  const { precioMayorista } = datos;
  const problemas: string[] = [];
  problemas.push(...datosInventados(texto, datos.contexto));

  const palabras = texto.split(/\s+/).filter(Boolean).length;
  if (palabras > PALABRAS_MAXIMAS) problemas.push(`Tiene ${palabras} palabras: máximo unas 35, en 2 frases cortas.`);
  if (frases(texto) > 2) problemas.push("Tiene más de 2 frases.");
  const preguntas = (texto.match(/\?/g) ?? []).length;
  if (preguntas > 1) problemas.push("Hace más de una pregunta: deja solo una, al final.");
  if (!TERMINA_EN_PREGUNTA.test(texto)) problemas.push("No termina con una pregunta que avance la venta.");

  if (/\bpero\b/i.test(texto)) problemas.push('Usa la palabra "pero": cámbiala por "sin embargo".');
  if (/sigues interesad[ao]/i.test(texto)) problemas.push('Dice "¿sigues interesada?": está prohibido.');
  if (/cuando puedas me avisas/i.test(texto)) problemas.push('Dice "cuando puedas me avisas": está prohibido.');
  if (/mayoris|al por mayor|por mayor/i.test(texto)) problemas.push("Menciona el precio al por mayor: está prohibido.");
  if (precioMayorista && mencionaElValor(texto, precioMayorista)) problemas.push("Incluye el precio mayorista: está prohibido.");
  if (/descuento/i.test(texto)) problemas.push("Menciona descuentos: no se ofrecen.");
  if (/\bvos\b|\bpodés\b|\btenés\b|\bquerés\b/i.test(texto)) problemas.push("Usa voseo: tutea (tú).");

  // Nada de repetir: un precio que ya se dijo, salvo que la clienta lo este preguntando ahora.
  if (!PREGUNTA_POR_PRECIO.test(datos.ultimoDeLaClienta)) {
    const repetidos = montos(texto).filter((monto) => montos(datos.yaDijimos).includes(monto));
    if (repetidos.length > 0) problemas.push("Repite un precio que ya se le dijo: no lo repitas, avanza.");
  }
  if (/garant|personaliz/i.test(texto) && !PREGUNTA_POR_CALIDAD.test(datos.ultimoDeLaClienta)) {
    problemas.push("Habla de garantía o fabricación personalizada sin que la clienta preguntara por calidad o confianza: quítalo.");
  }
  return problemas;
}

/** Frases: lo que termina en . ! o ? seguido de espacio o del final (un $989.000 no corta). */
function frases(texto: string) {
  return (texto.match(/[.!?…]+(?=\s|$)/g) ?? []).length || 1;
}

function montos(fuente: string) {
  return [...fuente.matchAll(/\$\s?(\d{1,3}(?:[.,]\d{3})+|\d{4,})/g)].map((m) => Number(m[1].replace(/[.,]/g, "")));
}

/**
 * Precios, plazos y medidas que la sugerencia escribe y que NO estan en el contexto (libro,
 * producto, conversacion). Un precio vale tambien si es la mitad de uno conocido: el anticipo del 50%.
 */
function datosInventados(texto: string, contexto: string) {
  const problemas: string[] = [];
  const conocidos = new Set<number>();
  for (const monto of montos(contexto)) {
    conocidos.add(monto);
    conocidos.add(Math.round(monto / 2));
  }
  const inventados = montos(texto).filter((monto) => !conocidos.has(monto));
  if (inventados.length > 0) {
    problemas.push(
      `Escribe valores que no están en los datos (${inventados.map((m) => `$${m.toLocaleString("es-CO")}`).join(", ")}): quítalos y di que ese valor se lo confirmas.`,
    );
  }

  const sinTildes = (fuente: string) => fuente.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const contextoPlano = sinTildes(contexto);
  const plazos = sinTildes(texto).match(/\d+(\s*(a|-|y)\s*\d+)?\s*(dias|semanas|horas|meses)(\s+habiles)?/g) ?? [];
  const plazosInventados = plazos.filter((plazo) => !contextoPlano.includes(plazo));
  if (plazosInventados.length > 0) {
    problemas.push(`Promete un tiempo que no está en los datos ("${plazosInventados.join('", "')}"): no lo des, di que lo confirmas.`);
  }

  const medidas = sinTildes(texto).match(/\d+([.,]\d+)?\s*(cm|centimetros|metros|mts|kg|kilos)\b/g) ?? [];
  const sinEspacios = contextoPlano.replace(/\s+/g, "");
  const medidasInventadas = medidas.filter((medida) => !sinEspacios.includes(medida.replace(/\s+/g, "")));
  if (medidasInventadas.length > 0) {
    problemas.push(`Da medidas que no están en los datos ("${medidasInventadas.join('", "')}"): no las inventes.`);
  }
  return problemas;
}

function mencionaElValor(texto: string, valor: number) {
  const soloDigitos = texto.replace(/[.\s,$]/g, "");
  return soloDigitos.includes(String(Math.round(valor)));
}

/**
 * La ultima red: lo que el modelo no corrigio en los reintentos se arregla sin inventar.
 * "pero" -> "sin embargo" y fuera las frases prohibidas.
 */
function ultimosArreglos(texto: string) {
  return texto
    .replace(/,\s*pero\s+/gi, "; sin embargo, ")
    .replace(/(^|[.!?¡¿]\s+)pero\s+/gi, (_, antes: string) => `${antes}Sin embargo, `)
    .replace(/\bpero\b/gi, "sin embargo")
    .replace(/¿?\s*sigues interesad[ao]\s*\??/gi, "")
    .replace(/cuando puedas me avisas[.!]?/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Marca que la sugerencia se envio, y si la vendedora la edito antes.
 *
 * "Editada" compara el texto con los espacios normalizados: un salto de linea de mas no es editar.
 * Solo marca una sugerencia de ESA vendedora y que todavia no se haya enviado. Nunca falla hacia
 * afuera: un registro que no se guarda no puede frenar un mensaje que ya salio.
 */
export async function registrarEnvioDeSugerencia(input: {
  sugerenciaId: string;
  userId: string;
  workspaceId: string;
  mensaje: string;
}) {
  try {
    const sugerencia = await prisma.sugerenciaDeRespuesta.findFirst({
      where: { id: input.sugerenciaId, userId: input.userId, workspaceId: input.workspaceId, enviadaEn: null },
      select: { id: true, texto: true },
    });
    if (!sugerencia) return;
    const normalizar = (texto: string) => texto.replace(/\s+/g, " ").trim();
    await prisma.sugerenciaDeRespuesta.update({
      where: { id: sugerencia.id },
      data: {
        enviadaEn: new Date(),
        textoEnviado: input.mensaje,
        editada: normalizar(input.mensaje) !== normalizar(sugerencia.texto),
      },
    });
  } catch (error) {
    console.warn("[sugerencia] no se pudo registrar el envio", error instanceof Error ? error.message : String(error));
  }
}

/** Marca que la vendedora toco "Enviar flujo" de una sugerencia. Mismas protecciones que el envio. */
export async function registrarFlujoDeSugerencia(input: { sugerenciaId: string; userId: string; workspaceId: string }) {
  try {
    await prisma.sugerenciaDeRespuesta.updateMany({
      where: { id: input.sugerenciaId, userId: input.userId, workspaceId: input.workspaceId, flujoEnviadoEn: null },
      data: { flujoEnviadoEn: new Date() },
    });
  } catch (error) {
    console.warn("[sugerencia] no se pudo registrar el flujo", error instanceof Error ? error.message : String(error));
  }
}
