import { prisma } from "@/lib/prisma";
import type { ActiveProductContext } from "@/lib/agent-product-flow";
import { esNotaInternaDelAgente } from "@/lib/notas-internas-del-agente";
import { leerLibro } from "@/features/agente-v3/servicios/almacen";

/**
 * La estrella ✨ del cuadro de mensajes: le redacta a la vendedora una respuesta para ESTE chat.
 *
 * Nunca envia nada: el texto se escribe en la caja y ella lo edita, lo manda o lo borra.
 *
 * Antes la estrella le pasaba al modelo el prompt entero del agente V2 (todos los embudos pegados)
 * y solo andaba en chats con agente: en Ventas 2 decia "no tiene un agente asignado" (Alex,
 * 03-10-2026). Ahora usa lo mismo que el agente V3 -el texto "Como hablamos" del libro, que es la
 * fuente de las formas de pago y los datos fijos-, el producto activo con su descripcion para el
 * agente y los ultimos mensajes, y las reglas de venta de Alex se COMPRUEBAN en el texto que sale,
 * no solo se piden.
 */

const MODELO = "gpt-4.1-mini";
const PLAZO_MS = 25_000;
const MENSAJES_DE_CONTEXTO = 20;

const PESOS = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

const REGLAS = `REGLAS DE LA RESPUESTA (todas obligatorias):
- Español de Colombia. Tutea al cliente (tú, nunca vos ni usted). Frases cortas. Máximo 3 párrafos, separados por una línea en blanco.
- Si hablas de precio, envío o forma de pago, van siempre por escrito y claros, con el valor exacto.
- Cuando el tema sea precio o pago, ofrece LAS DOS formas de pago tal como están en los datos del negocio: anticipo (50% para fabricar y 50% antes del despacho, con envío gratis a ciudades principales) o contraentrega (paga por adelantado solo el envío y el resto al recibir).
- Nunca escribas la palabra "pero": usa "sin embargo".
- Nunca escribas "¿sigues interesada?" ni "¿sigues interesado?" ni "cuando puedas me avisas".
- Termina SIEMPRE con una pregunta que haga avanzar la venta (ciudad, cuándo lo necesita, forma de pago, color, si lo apartamos...).
- No inventes precios, medidas, materiales ni tiempos de entrega. Usa solo lo que está en los datos de abajo. Si falta un dato, di que lo confirmas en vez de inventarlo. El valor del envío a una ciudad y los tiempos de fabricación o entrega NO están en los datos: nunca los des con número, di que se los confirmas.
- Nunca ofrezcas ni menciones precio al por mayor ni descuentos.
- Negrita de WhatsApp con UN solo asterisco (*así*), nunca doble.
- No repitas un saludo si la conversación ya empezó, y no firmes el mensaje.
- Devuelve SOLO el texto del mensaje, sin comillas ni explicaciones.`;

export type Linea = { de: "cliente" | "negocio"; texto: string };

export type SugerenciaGenerada = { texto: string; productoId: string | null } | { error: string };

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

  const producto = await leerProducto(input.workspaceId, chat.productoId);
  const libro = await leerLibro(input.workspaceId).catch(() => null);
  const texto = await redactarSugerencia({
    apiKey,
    comoHablamos: libro?.comoHablamos?.trim() || "",
    producto,
    lineas: chat.lineas,
  });
  if (!texto) {
    return { error: "No se pudo generar la sugerencia. Inténtalo de nuevo." };
  }
  return { texto, productoId: producto?.id ?? null };
}

export type ProductoParaSugerir = {
  id: string;
  nombre: string;
  codigo: string | null;
  precio: string;
  descripcion: string | null;
  precioMayorista: number | null;
};

/** La redaccion pura, sin base: prompt, comprobacion de reglas, un reintento y los arreglos finales. */
export async function redactarSugerencia(input: {
  apiKey: string;
  comoHablamos: string;
  producto: ProductoParaSugerir | null;
  lineas: Linea[];
}): Promise<string | null> {
  const { apiKey, comoHablamos, producto } = input;
  const sistema = [
    "Eres una vendedora experta de Magilus que le escribe por WhatsApp a un cliente. Redactas la PRÓXIMA respuesta de la vendedora en esta conversación.",
    REGLAS,
    comoHablamos ? `DATOS DEL NEGOCIO Y FORMA DE HABLAR (fuente de verdad: precios, pagos, envíos, materiales):\n${comoHablamos}` : "",
    producto
      ? `PRODUCTO DEL QUE SE ESTÁ HABLANDO:\n*${producto.nombre}*${producto.codigo ? ` (${producto.codigo})` : ""}\nPrecio: ${producto.precio}\n${producto.descripcion ? `Descripción para el agente:\n${producto.descripcion}` : "Sin descripción: no inventes características."}`
      : "No hay un producto identificado en esta conversación: si el cliente pregunta por uno, pregunta cuál o confírmalo, sin inventar precios.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const conversacion = input.lineas
    .map((linea) => `${linea.de === "cliente" ? "Cliente" : "Vendedora"}: ${linea.texto}`)
    .join("\n");

  const pedido = `Conversación (de la más vieja a la más nueva):\n${conversacion}\n\nEscribe la próxima respuesta de la vendedora.`;

  let texto = await pedirAlModelo(apiKey, sistema, [{ role: "user", content: pedido }]);
  if (!texto) {
    return null;
  }
  texto = arreglosSeguros(texto);

  /*
    Las reglas se COMPRUEBAN: si algo no cumple, se le devuelve al modelo con el detalle, hasta dos
    veces. El contexto es todo lo que la sugerencia puede citar: un precio, un plazo o una medida que
    no este ahi es inventado (probando salio "envio aproximado de $120.000" y "7 a 10 dias habiles").
  */
  const contexto = [sistema, conversacion].join("\n");
  const revisar = (borrador: string) =>
    problemasDeLaSugerencia(borrador, { precioMayorista: producto?.precioMayorista ?? null, contexto });
  for (let intento = 0; intento < 2; intento += 1) {
    const problemas = revisar(texto);
    if (problemas.length === 0) break;
    const corregido = await pedirAlModelo(apiKey, sistema, [
      { role: "user", content: pedido },
      { role: "assistant", content: texto },
      {
        role: "user",
        content: `Esa respuesta no cumple estas reglas:\n${problemas.map((p) => `- ${p}`).join("\n")}\n\nReescríbela cumpliéndolas todas. Devuelve solo el mensaje.`,
      },
    ]);
    if (!corregido) break;
    texto = arreglosSeguros(corregido);
  }

  // Lo que el modelo no corrigio, se corrige a mano (sin inventar nada).
  return ultimosArreglos(texto);
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
          select: { direction: true, type: true, content: true },
        },
      },
    });
    if (!chat) return null;
    return {
      productoId: idDelProducto(chat.activeProductContext),
      lineas: aLineas(chat.messages.map((m) => ({ ...m, transcripcion: null }))),
    };
  }

  const chat = await prisma.conversation.findFirst({
    where: { id: input.conversationId, workspaceId: input.workspaceId },
    select: {
      activeProductContext: true,
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: MENSAJES_DE_CONTEXTO,
        select: { direction: true, type: true, content: true, transcripcion: true },
      },
    },
  });
  if (!chat) return null;
  return { productoId: idDelProducto(chat.activeProductContext), lineas: aLineas(chat.messages) };
}

function idDelProducto(contexto: unknown) {
  const id = (contexto as ActiveProductContext | null | undefined)?.productId;
  return typeof id === "string" && id ? id : null;
}

/** Los mensajes, en orden, como los leeria una persona. Sin avisos del sistema ni notas internas. */
function aLineas(
  mensajes: Array<{ direction: string; type: string; content: string | null; transcripcion: string | null }>,
): Linea[] {
  return [...mensajes]
    .reverse()
    .filter((m) => m.type !== "SYSTEM" && !esNotaInternaDelAgente(m))
    .map((m) => {
      const contenido = m.content?.trim() || "";
      const texto =
        m.type === "AUDIO"
          ? `[nota de voz${m.transcripcion ? `: ${m.transcripcion.trim()}` : ""}]`
          : m.type === "IMAGE"
            ? `[foto]${contenido ? ` ${contenido}` : ""}`
            : m.type === "VIDEO"
              ? `[video]${contenido ? ` ${contenido}` : ""}`
              : m.type === "DOCUMENT"
                ? `[documento]${contenido ? ` ${contenido}` : ""}`
                : contenido;
      return { de: m.direction === "INBOUND" ? ("cliente" as const) : ("negocio" as const), texto: texto.slice(0, 800) };
    })
    .filter((linea) => linea.texto);
}

async function leerProducto(workspaceId: string, productoId: string | null) {
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
        messages: [{ role: "system", content: sistema }, ...mensajes],
      }),
    });
    if (!respuesta.ok) {
      console.warn("[sugerencia] el modelo respondio", respuesta.status);
      return null;
    }
    const datos = (await respuesta.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const texto = datos.choices?.[0]?.message?.content?.trim();
    return texto ? texto.replace(/^["“]|["”]$/g, "").trim() : null;
  } catch (error) {
    console.warn("[sugerencia] fallo la llamada", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** Arreglos que no cambian el sentido: negrita doble a simple y espacios de mas. */
function arreglosSeguros(texto: string) {
  return texto
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const TERMINA_EN_PREGUNTA = /\?[\s\p{Extended_Pictographic}‍️]*$/u;

export function problemasDeLaSugerencia(
  texto: string,
  datos: { precioMayorista: number | null; contexto: string },
) {
  const { precioMayorista } = datos;
  const problemas: string[] = [];
  problemas.push(...datosInventados(texto, datos.contexto));
  if (/\bpero\b/i.test(texto)) problemas.push('Usa la palabra "pero": cámbiala por "sin embargo".');
  if (/sigues interesad[ao]/i.test(texto)) problemas.push('Dice "¿sigues interesada?": está prohibido.');
  if (/cuando puedas me avisas/i.test(texto)) problemas.push('Dice "cuando puedas me avisas": está prohibido.');
  if (parrafos(texto).length > 3) problemas.push("Tiene más de 3 párrafos.");
  if (!TERMINA_EN_PREGUNTA.test(texto)) problemas.push("No termina con una pregunta que avance la venta.");
  if (/mayoris|al por mayor|por mayor/i.test(texto)) problemas.push("Menciona el precio al por mayor: está prohibido.");
  if (precioMayorista && mencionaElValor(texto, precioMayorista)) problemas.push("Incluye el precio mayorista: está prohibido.");
  if (/descuento/i.test(texto)) problemas.push("Menciona descuentos: no se ofrecen.");
  if (/\bvos\b|\bpodés\b|\btenés\b|\bquerés\b/i.test(texto)) problemas.push("Usa voseo: tutea (tú).");
  return problemas;
}

/**
 * Precios, plazos y medidas que la sugerencia escribe y que NO estan en el contexto (libro,
 * producto, conversacion). Un precio vale tambien si es la mitad de uno conocido: el anticipo del 50%.
 */
function datosInventados(texto: string, contexto: string) {
  const problemas: string[] = [];
  const montos = (fuente: string) =>
    [...fuente.matchAll(/\$\s?(\d{1,3}(?:[.,]\d{3})+|\d{4,})/g)].map((m) => Number(m[1].replace(/[.,]/g, "")));
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

function parrafos(texto: string) {
  return texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

function mencionaElValor(texto: string, valor: number) {
  const soloDigitos = texto.replace(/[.\s,$]/g, "");
  return soloDigitos.includes(String(Math.round(valor)));
}

/**
 * La ultima red: lo que el modelo no corrigio en el segundo intento se arregla sin inventar.
 * "pero" -> "sin embargo", fuera las frases prohibidas, y los parrafos de mas se juntan en el tercero.
 */
function ultimosArreglos(texto: string) {
  let limpio = texto
    .replace(/,\s*pero\s+/gi, "; sin embargo, ")
    .replace(/(^|[.!?¡¿]\s+|\n)pero\s+/gi, (_, antes: string) => `${antes}Sin embargo, `)
    .replace(/\bpero\b/gi, "sin embargo")
    .replace(/¿?\s*sigues interesad[ao]\s*\??/gi, "")
    .replace(/cuando puedas me avisas[.!]?/gi, "")
    .replace(/[ \t]{2,}/g, " ");
  const bloques = parrafos(limpio);
  if (bloques.length > 3) {
    limpio = [...bloques.slice(0, 2), bloques.slice(2).join(" ")].join("\n\n");
  } else {
    limpio = bloques.join("\n\n");
  }
  return limpio.trim();
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
