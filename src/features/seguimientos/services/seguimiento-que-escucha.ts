import type { ActiveProductContext } from "@/lib/agent-product-flow";
import { leerLibro } from "@/features/agente-v3/servicios/almacen";
import { soloMandoElAnuncio, VENTANA_DEL_ANUNCIO_MS } from "@/lib/anti-bloqueo/reglas";
import { esNotaInternaDelAgente } from "@/lib/notas-internas-del-agente";
import { prisma } from "@/lib/prisma";
import type { Linea } from "@/lib/sugerencia-de-respuesta";
import { transcribirAudioAhora } from "@/lib/transcripcion-de-audios";
import {
  armarPedidoDeSeguimiento,
  elegirTexto,
  INTENTOS_MAXIMOS,
  revisarSeguimiento,
} from "@/features/seguimientos/dominio/seguimiento-que-escucha";

/**
 * SEGUIMIENTOS QUE ESCUCHAN AL CLIENTE (parte 2: el redactor).
 *
 * Justo antes de mandar un seguimiento automatico de texto (los de 1, 3 y 7 dias), lee TODA la
 * conversacion -textos, notas de voz del cliente y de la asesora ya pasadas a texto, fotos y
 * catalogos enviados-, los seguimientos que ya le llegaron, el producto y el libro del V3, y le pide
 * a la IA un mensaje que hable de lo que ESE cliente dijo. Lo que propone pasa por el revisor de la
 * parte 1 (`elegirTexto`): si no pasa, sale el texto fijo, o la pregunta del producto, o nada.
 *
 * Lee como la estrella de sugerencias (src/lib/sugerencia-de-respuesta.ts), pero con todos los
 * mensajes y no solo los ultimos 20.
 *
 * No decide CUANDO sale ni CUANTOS salen: eso sigue igual (frenos y anti-bloqueo, en follows.ts).
 *
 * Para apagarlo sin desplegar: `AppSetting` `seguimientos-que-escuchan:apagado` = "si". Apagado, o
 * sin clave de OpenAI, devuelve el texto fijo tal cual (como antes de este cambio).
 */

export const CLAVE_APAGADO = "seguimientos-que-escuchan:apagado";

const MODELO = "gpt-4.1-mini";

/** Tiempo limite de cada llamada a OpenAI. */
const PLAZO_MS = 15_000;

/** Redacciones con IA por vuelta del reloj (cada minuto). Las que no alcanzan esperan la siguiente. */
export const TOPE_POR_VUELTA = 6;

/** Notas de voz sin texto que se transcriben al momento, por seguimiento (las mas nuevas). */
const AUDIOS_AL_MOMENTO = 4;

/** Tope de mensajes leidos de una conversacion (una charla real nunca se acerca). */
const MENSAJES_MAXIMOS = 2_000;

/** Lo que dijo el cliente antes de las ultimas lineas, para que la IA no lo pierda. */
const CARACTERES_DE_LO_ANTERIOR = 3_000;

/** Lo que va en el `rawPayload` del mensaje enviado cuando lo escribio la IA. */
export type MarcaDelSeguimiento = { deIA: true; textoReemplazado: string | null };

export type SeguimientoRedactado =
  | {
      enviar: true;
      texto: string;
      deIA: boolean;
      /** El texto fijo que se cambio (null si sale el fijo tal cual). */
      textoReemplazado: string | null;
      motivo: string;
    }
  | {
      enviar: false;
      texto: null;
      deIA: false;
      textoReemplazado: null;
      motivo: string;
      /** true: no se cancela, se manda en la vuelta siguiente del reloj (tope por vuelta). */
      esperarVuelta: boolean;
    };

/* ---------------------------------------------------------------------------------------------
   El tope por vuelta del reloj
--------------------------------------------------------------------------------------------- */

let redaccionesEnLaVuelta = 0;

/** La llama el reloj (executePendingFollows) al empezar cada vuelta. */
export function empezarVueltaDelRedactor() {
  redaccionesEnLaVuelta = 0;
}

/* ---------------------------------------------------------------------------------------------
   Lectura
--------------------------------------------------------------------------------------------- */

const VALORES_DE_APAGADO = new Set(["si", "sí", "on", "true", "1"]);

/** ¿Esta apagado el redactor? Si no se puede leer la bandera, se toma como apagado (texto de hoy). */
export async function redactorApagado(): Promise<boolean> {
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: CLAVE_APAGADO }, select: { value: true } });
    return VALORES_DE_APAGADO.has((fila?.value ?? "").trim().toLowerCase());
  } catch {
    return true;
  }
}

type MensajeLeido = {
  id: string;
  direction: string;
  type: string;
  content: string | null;
  mediaUrl: string | null;
  transcripcion: string | null;
  transcritoEn: Date | null;
  rawPayload: unknown;
  createdAt: Date;
};

function origenDelMensaje(rawPayload: unknown): string | null {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return null;
  const origen = (rawPayload as Record<string, unknown>).source;
  return typeof origen === "string" ? origen : null;
}

/**
 * Las notas de voz que todavia no tienen texto (el reloj las transcribe al minuto de llegar, pero un
 * seguimiento puede salir antes): se pasan a texto ahora y se guardan, para no pagarlas dos veces.
 */
async function transcribirLasQueFaltan(mensajes: MensajeLeido[]) {
  const faltan = mensajes
    .filter((m) => m.type === "AUDIO" && m.mediaUrl?.trim() && m.transcripcion === null && m.transcritoEn === null)
    .slice(-AUDIOS_AL_MOMENTO);
  for (const mensaje of faltan) {
    const texto = await transcribirAudioAhora(mensaje.mediaUrl!).catch(() => null);
    if (!texto) continue;
    mensaje.transcripcion = texto;
    await prisma.message
      .update({ where: { id: mensaje.id }, data: { transcripcion: texto, transcritoEn: new Date() } })
      .catch(() => {});
  }
}

/** Los mensajes como los leeria una persona (igual que la sugerencia), de lo mas viejo a lo mas nuevo. */
function aLineas(mensajes: MensajeLeido[]): Linea[] {
  return mensajes
    .filter((m) => m.type !== "SYSTEM" && !esNotaInternaDelAgente(m))
    .map((m) => {
      const contenido = m.content?.trim() || "";
      const texto =
        m.type === "AUDIO"
          ? m.transcripcion?.trim()
            ? `[nota de voz] ${m.transcripcion.trim()}`
            : "[nota de voz sin transcribir]"
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

/** "3 fotos, 1 video, documentos: CATALOGO.pdf": lo que ya se le mando aparte del texto. */
function resumirLoEnviado(mensajes: MensajeLeido[]): string {
  const salientes = mensajes.filter((m) => m.direction === "OUTBOUND" && m.mediaUrl);
  const cuantos = (tipo: string) => salientes.filter((m) => m.type === tipo).length;
  const documentos = [
    ...new Set(salientes.filter((m) => m.type === "DOCUMENT" && m.content?.trim()).map((m) => m.content!.trim().slice(0, 60))),
  ].slice(0, 8);
  return [
    cuantos("IMAGE") ? `${cuantos("IMAGE")} fotos` : "",
    cuantos("VIDEO") ? `${cuantos("VIDEO")} videos` : "",
    cuantos("AUDIO") ? `${cuantos("AUDIO")} notas de voz` : "",
    documentos.length ? `documentos: ${documentos.join(", ")}` : cuantos("DOCUMENT") ? `${cuantos("DOCUMENT")} documentos` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** Los mismos datos que usa el anti-bloqueo para saber si el cliente solo mando el texto del anuncio. */
function soloElAnuncio(mensajes: MensajeLeido[]): boolean {
  const entrantes = mensajes.filter((m) => m.direction === "INBOUND" && m.type !== "SYSTEM");
  const primero = entrantes[0]?.createdAt ?? null;
  const limite = primero ? primero.getTime() + VENTANA_DEL_ANUNCIO_MS : 0;
  return soloMandoElAnuncio({
    primerEntrante: primero,
    ultimoEntrante: entrantes[entrantes.length - 1]?.createdAt ?? null,
    entrantesDespuesDelAnuncio: entrantes.filter((m) => m.createdAt.getTime() > limite).length,
    automaticos: [],
  });
}

function idDelProducto(contexto: unknown) {
  const id = (contexto as ActiveProductContext | null | undefined)?.productId;
  return typeof id === "string" && id ? id : null;
}

const PESOS = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

/** El producto del chat: nombre, precio y descripcion. A proposito SIN costo, margen ni mayorista. */
async function leerProducto(workspaceId: string, productoId: string | null) {
  if (!productoId) return null;
  const producto = await prisma.product
    .findFirst({
      where: { id: productoId, workspaceId },
      select: { name: true, price: true, description: true, activo: true },
    })
    .catch(() => null);
  if (!producto || !producto.activo) return null;
  return {
    nombre: producto.name,
    datos: [
      `${producto.name}: ${PESOS.format(Number(producto.price))}`,
      producto.description?.trim() ? producto.description.trim().slice(0, 1_500) : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/* ---------------------------------------------------------------------------------------------
   La IA
--------------------------------------------------------------------------------------------- */

type MensajeDelModelo = { role: "user" | "assistant"; content: string };

async function pedirAlModelo(apiKey: string, sistema: string, mensajes: MensajeDelModelo[]): Promise<string | null> {
  try {
    const respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(PLAZO_MS),
      body: JSON.stringify({
        model: MODELO,
        temperature: 0.5,
        messages: [{ role: "system", content: sistema }, ...mensajes],
      }),
    });
    if (!respuesta.ok) {
      console.warn("[seguimiento-que-escucha] el modelo respondio", respuesta.status);
      return null;
    }
    const datos = (await respuesta.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const texto = datos.choices?.[0]?.message?.content?.trim() ?? "";
    // Sin comillas alrededor y sin negrita doble.
    return texto.replace(/^["“]|["”]$/g, "").replace(/\*\*(.+?)\*\*/g, "*$1*").trim() || null;
  } catch (error) {
    console.warn("[seguimiento-que-escucha] fallo la llamada", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/* ---------------------------------------------------------------------------------------------
   El redactor
--------------------------------------------------------------------------------------------- */

function textoFijoTalCual(textoFijo: string, motivo: string): SeguimientoRedactado {
  return { enviar: true, texto: textoFijo, deIA: false, textoReemplazado: null, motivo };
}

/**
 * El texto de un seguimiento automatico para ESTE cliente.
 *  - `textoFijo`: el que hoy saldria (el de la regla o la escalera, ya armado).
 *  - `paso`: numero del seguimiento desde que el cliente se callo (1 = el primero).
 *  - `origen`: de donde sale (el nombre del Follow), solo para el registro.
 * Nunca lanza: ante cualquier falla de lectura devuelve el texto fijo tal cual.
 */
export async function redactarSeguimientoQueEscucha(input: {
  conversationId: string;
  workspaceId: string;
  textoFijo: string;
  paso: number;
  origen: string;
}): Promise<SeguimientoRedactado> {
  const textoFijo = input.textoFijo ?? "";
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return textoFijoTalCual(textoFijo, "sin clave de OpenAI: sale el texto fijo");
  if (await redactorApagado()) return textoFijoTalCual(textoFijo, `${CLAVE_APAGADO}: sale el texto fijo`);

  // El tope se cuenta ANTES de leer y llamar a la IA: lo que no alcanza espera la vuelta siguiente.
  if (redaccionesEnLaVuelta >= TOPE_POR_VUELTA) {
    return {
      enviar: false,
      texto: null,
      deIA: false,
      textoReemplazado: null,
      motivo: `tope de ${TOPE_POR_VUELTA} redacciones por vuelta: sale en la vuelta siguiente`,
      esperarVuelta: true,
    };
  }
  redaccionesEnLaVuelta += 1;

  let leido;
  try {
    leido = await prisma.conversation.findFirst({
      where: { id: input.conversationId, workspaceId: input.workspaceId },
      select: {
        activeProductContext: true,
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: MENSAJES_MAXIMOS,
          select: {
            id: true,
            direction: true,
            type: true,
            content: true,
            mediaUrl: true,
            transcripcion: true,
            transcritoEn: true,
            rawPayload: true,
            createdAt: true,
          },
        },
      },
    });
  } catch (error) {
    console.warn("[seguimiento-que-escucha] no se pudo leer el chat", error instanceof Error ? error.message : String(error));
    return textoFijoTalCual(textoFijo, "no se pudo leer la conversación: sale el texto fijo");
  }
  if (!leido) return textoFijoTalCual(textoFijo, "conversación no encontrada: sale el texto fijo");

  const mensajes = [...(leido.messages as MensajeLeido[])].reverse();
  await transcribirLasQueFaltan(mensajes);

  const lineas = aLineas(mensajes);
  const yaEnviados = mensajes
    .filter((m) => m.direction === "OUTBOUND" && origenDelMensaje(m.rawPayload) === "follow" && m.content?.trim())
    .map((m) => m.content!.trim());
  const [producto, libro] = await Promise.all([
    leerProducto(input.workspaceId, idDelProducto(leido.activeProductContext)),
    leerLibro(input.workspaceId).catch(() => null),
  ]);
  const datosDelLibro = [libro?.comoHablamos?.trim() ?? "", producto?.datos ?? ""].filter(Boolean).join("\n\n") || null;

  const pedido = armarPedidoDeSeguimiento({
    lineas,
    producto: producto?.nombre ?? null,
    paso: Math.max(1, Math.round(input.paso || 1)),
    yaEnviados,
    datosDelLibro,
    soloMandoElAnuncio: soloElAnuncio(mensajes),
  });

  // El pedido trae las ultimas lineas: lo que el cliente dijo antes (de toda la charla) va aparte.
  const anteriores = lineas.slice(0, -30).filter((l) => l.de === "cliente").map((l) => `- ${l.texto.replace(/\s+/g, " ")}`);
  const loAnterior = anteriores.join("\n").slice(-CARACTERES_DE_LO_ANTERIOR);
  const enviado = resumirLoEnviado(mensajes);
  const contexto = [
    pedido.contexto,
    loAnterior ? `\nLO QUE EL CLIENTE DIJO ANTES EN ESTA CONVERSACIÓN:\n${loAnterior}` : "",
    `\nYA SE LE ENVIÓ APARTE DEL TEXTO: ${enviado || "nada"}`,
  ]
    .filter(Boolean)
    .join("\n");

  // Hasta 3 propuestas: si una no pasa la revision, se le devuelve a la IA con los problemas.
  const revision = {
    conversacion: lineas,
    yaEnviados,
    textoDelLibro: [datosDelLibro ?? "", producto?.nombre ?? ""].join("\n"),
  };
  const propuestas: string[] = [];
  const charla: MensajeDelModelo[] = [{ role: "user", content: contexto }];
  for (let intento = 0; intento < INTENTOS_MAXIMOS; intento += 1) {
    const propuesta = await pedirAlModelo(apiKey, pedido.instrucciones, charla);
    if (!propuesta) break;
    propuestas.push(propuesta);
    const problemas = revisarSeguimiento(propuesta, revision);
    if (!problemas.length) break;
    charla.push(
      { role: "assistant", content: propuesta },
      {
        role: "user",
        content: `Ese mensaje no sirve:\n${problemas.map((p) => `- ${p}`).join("\n")}\nEscríbelo de nuevo cumpliendo todas las reglas. Solo el texto.`,
      },
    );
  }

  const elegido = elegirTexto({
    propuestas,
    textoFijo,
    producto: producto?.nombre ?? null,
    conversacion: lineas,
    yaEnviados,
    textoDelLibro: datosDelLibro,
  });

  if (elegido.descartados.length) {
    console.log("[seguimiento-que-escucha] descartados", {
      conversationId: input.conversationId,
      origen: input.origen,
      descartados: elegido.descartados.map((d) => ({ problemas: d.problemas })),
    });
  }

  if (!elegido.enviar) {
    return { enviar: false, texto: null, deIA: false, textoReemplazado: null, motivo: elegido.motivo, esperarVuelta: false };
  }
  const reemplazado = elegido.texto.trim() !== textoFijo.trim();
  return {
    enviar: true,
    texto: elegido.texto,
    deIA: elegido.origen === "ia",
    textoReemplazado: reemplazado ? textoFijo : null,
    motivo:
      elegido.origen === "ia"
        ? "lo escribió la IA con lo que dijo el cliente"
        : elegido.origen === "fijo"
          ? propuestas.length
            ? "la IA no pasó la revisión: sale el texto fijo"
            : "la IA no respondió: sale el texto fijo"
          : "ni la IA ni el texto fijo pasaron la revisión: sale la pregunta del producto",
  };
}
