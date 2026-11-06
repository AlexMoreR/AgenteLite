import { prisma } from "@/lib/prisma";
import type { ActiveProductContext } from "@/lib/agent-product-flow";
import { esNotaInternaDelAgente } from "@/lib/notas-internas-del-agente";
import { leerLibro } from "@/features/agente-v3/servicios/almacen";
import { transcribirAudioAhora } from "@/lib/transcripcion-de-audios";
import { soloMandoElAnuncio, VENTANA_DEL_ANUNCIO_MS } from "@/lib/anti-bloqueo/reglas";
import type { Linea } from "@/lib/sugerencia-de-respuesta";
import {
  armarPedidoDeSeguimiento,
  elegirTexto,
  INTENTOS_MAXIMOS,
  revisarSeguimiento,
  type RevisionDelSeguimiento,
} from "@/features/seguimientos/dominio/seguimiento-que-escucha";

/**
 * SEGUIMIENTOS QUE ESCUCHAN AL CLIENTE (parte 2: el redactor).
 *
 * Antes de mandar un seguimiento automatico de texto, lee la conversacion COMPLETA (textos, notas de
 * voz del cliente y de la asesora ya pasadas a texto, fotos y catalogos enviados), los seguimientos
 * que ya le llegaron, el producto y el libro del V3, y le pide a la IA un mensaje que hable de lo que
 * ESE cliente dijo. Lo que proponga pasa por el revisor de la parte 1 (`elegirTexto`): si no pasa,
 * sale el cierre de apartar (si ya dio la ciudad), o el texto fijo, o la pregunta del producto, o nada.
 *
 * Con el interruptor `seguimientos-que-escuchan:apagado` = "si", o sin la clave de OpenAI, devuelve
 * el texto fijo tal cual: el comportamiento de antes. No cambia cuando sale cada seguimiento ni
 * cuantos salen; solo QUE dice.
 */

/** Interruptor para apagarlo sin desplegar: `seguimientos-que-escuchan:apagado` = "si". */
export const CLAVE_APAGADO = "seguimientos-que-escuchan:apagado";

/** El modelo y el tiempo limite, como la sugerencia de respuesta. */
const MODELO = "gpt-4.1-mini";
const PLAZO_MS = 15_000;

/** Redacciones con IA por vuelta del reloj (cada minuto). Las que no alcanzan salen en la siguiente. */
export const REDACCIONES_POR_VUELTA = 5;

/** Notas de voz sin texto que se transcriben en el momento, por seguimiento (las mas nuevas). */
const AUDIOS_AL_MOMENTO = 5;

/** Tope de mensajes leidos de una conversacion: todos, salvo un chat fuera de lo normal. */
const MENSAJES_MAXIMOS = 1_000;

/** Motivo con el que se cancela un seguimiento cuando ningun texto paso la revision. */
export const MOTIVO_SIN_TEXTO = "seguimiento_sin_texto_valido" as const;
/** Motivo con el que se corre a la vuelta siguiente porque ya se lleno el tope de la vuelta. */
export const MOTIVO_TOPE_DE_LA_VUELTA = "tope_de_redacciones" as const;
export type MotivoDelRedactor = typeof MOTIVO_SIN_TEXTO;

export type SeguimientoRedactado =
  | {
      enviar: true;
      texto: string;
      /** El texto lo escribio la IA (y paso la revision). */
      deIA: boolean;
      /** El texto fijo que se cambio, si salio otro (null = salio el fijo). */
      textoReemplazado: string | null;
      motivo: string;
    }
  | {
      enviar: false;
      texto: null;
      deIA: false;
      textoReemplazado: null;
      motivo: string;
      /** true = no se cancela: se vuelve a intentar en la vuelta siguiente del reloj. */
      reprogramar: boolean;
    };

/* ------------------------------------------------------------------------------------------------
   Tope por vuelta del reloj
------------------------------------------------------------------------------------------------ */

const vuelta = { minuto: -1, usadas: 0 };

/** Toma un lugar en la vuelta de este minuto. false = ya se lleno: va en la vuelta siguiente. */
function tomarLugarEnLaVuelta(ahora = Date.now()): boolean {
  const minuto = Math.floor(ahora / 60_000);
  if (vuelta.minuto !== minuto) {
    vuelta.minuto = minuto;
    vuelta.usadas = 0;
  }
  if (vuelta.usadas >= REDACCIONES_POR_VUELTA) return false;
  vuelta.usadas += 1;
  return true;
}

/** Solo para las pruebas: vacia el tope de la vuelta. */
export function reiniciarTopeDeLaVuelta() {
  vuelta.minuto = -1;
  vuelta.usadas = 0;
}

/* ------------------------------------------------------------------------------------------------
   La marca que se guarda en el mensaje enviado
------------------------------------------------------------------------------------------------ */

/**
 * Lo que se guarda en el `rawPayload` del mensaje enviado cuando el texto no es el fijo:
 * `seguimientoQueEscucha: {deIA, textoReemplazado}`. null = salio el texto fijo, no se marca nada.
 */
export function marcaDelSeguimiento(
  redactado: SeguimientoRedactado | null | undefined,
): { seguimientoQueEscucha: { deIA: boolean; textoReemplazado: string | null } } | null {
  if (!redactado || !redactado.enviar || redactado.textoReemplazado === null) return null;
  return { seguimientoQueEscucha: { deIA: redactado.deIA, textoReemplazado: redactado.textoReemplazado } };
}

/* ------------------------------------------------------------------------------------------------
   El redactor
------------------------------------------------------------------------------------------------ */

function textoFijoTalCual(textoFijo: string, motivo: string): SeguimientoRedactado {
  return { enviar: true, texto: textoFijo, deIA: false, textoReemplazado: null, motivo };
}

export async function redactarSeguimientoQueEscucha(input: {
  conversationId: string;
  workspaceId: string;
  /** El texto agendado (ya con el nombre puesto): es el respaldo y lo que sale si esto esta apagado. */
  textoFijo: string;
  /** Numero del seguimiento (1 = el primero del silencio). null = se cuenta con los ya enviados. */
  paso?: number | null;
  /** De donde viene ("follow", "flujo"): solo para el registro. */
  origen: string;
}): Promise<SeguimientoRedactado> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return textoFijoTalCual(input.textoFijo, "sin clave de OpenAI: texto fijo");

  try {
    const interruptor = await prisma.appSetting.findUnique({ where: { key: CLAVE_APAGADO } });
    if (interruptor?.value?.trim().toLowerCase() === "si") {
      return textoFijoTalCual(input.textoFijo, "interruptor apagado: texto fijo");
    }

    if (!tomarLugarEnLaVuelta()) {
      return {
        enviar: false,
        texto: null,
        deIA: false,
        textoReemplazado: null,
        motivo: MOTIVO_TOPE_DE_LA_VUELTA,
        reprogramar: true,
      };
    }

    const chat = await leerConversacion(input.workspaceId, input.conversationId);
    if (!chat) return textoFijoTalCual(input.textoFijo, "conversación no encontrada: texto fijo");

    const [producto, libro, yaEnviados] = await Promise.all([
      leerProducto(input.workspaceId, chat.productoId),
      leerLibro(input.workspaceId).catch(() => null),
      seguimientosYaEnviados(input.conversationId),
    ]);

    const datosDelLibro =
      [
        libro?.comoHablamos?.trim() || "",
        producto ? `Producto: ${producto.nombre}${producto.precio ? `, precio ${producto.precio}` : ""}` : "",
        producto?.descripcion ? `Descripción: ${producto.descripcion}` : "",
      ]
        .filter(Boolean)
        .join("\n") || null;

    const pedido = armarPedidoDeSeguimiento({
      lineas: chat.lineas,
      producto: producto?.nombre ?? null,
      paso: input.paso ?? pasoDelSilencio(yaEnviados.fechas, chat.ultimoDelCliente),
      yaEnviados: yaEnviados.textos,
      datosDelLibro,
      soloMandoElAnuncio: chat.soloMandoElAnuncio,
    });

    const revision: RevisionDelSeguimiento = {
      conversacion: chat.lineas,
      yaEnviados: yaEnviados.textos,
      textoDelLibro: [datosDelLibro ?? "", producto?.nombre ?? ""].join("\n"),
      // Sin el producto, los reintentos de la IA no verian la regla de la contraentrega (solo en el Combo).
      producto: producto?.nombre ?? null,
    };
    const propuestas = await pedirPropuestas(apiKey, pedido, revision);

    const elegido = elegirTexto({
      propuestas,
      textoFijo: input.textoFijo,
      producto: producto?.nombre ?? null,
      ...revision,
    });
    if (elegido.descartados.length) {
      console.info("[seguimiento-que-escucha] textos descartados", {
        conversationId: input.conversationId,
        origen: input.origen,
        descartados: elegido.descartados.map((d) => d.problemas),
      });
    }
    if (!elegido.enviar) {
      return { enviar: false, texto: null, deIA: false, textoReemplazado: null, motivo: MOTIVO_SIN_TEXTO, reprogramar: false };
    }
    const cambio = elegido.texto.trim() !== input.textoFijo.trim();
    return {
      enviar: true,
      texto: elegido.texto,
      deIA: elegido.origen === "ia",
      textoReemplazado: cambio ? input.textoFijo : null,
      motivo:
        elegido.origen === "ia"
          ? "lo escribió la IA"
          : elegido.origen === "cierre"
            ? propuestas.length
              ? "la IA no pasó la revisión: cierre de apartar"
              : "la IA no respondió: cierre de apartar"
            : elegido.origen === "fijo"
              ? propuestas.length
                ? "la IA no pasó la revisión: texto fijo"
                : "la IA no respondió: texto fijo"
              : "pregunta del producto del anuncio",
    };
  } catch (error) {
    // Nunca frena un envio por un error propio: sale el texto de antes.
    console.warn("[seguimiento-que-escucha] fallo; sale el texto fijo", {
      conversationId: input.conversationId,
      origen: input.origen,
      error: error instanceof Error ? error.message : String(error),
    });
    return textoFijoTalCual(input.textoFijo, "falló el redactor: texto fijo");
  }
}

/** El numero del seguimiento: los que salieron desde el ultimo mensaje del cliente, mas este. */
function pasoDelSilencio(fechas: Date[], ultimoDelCliente: Date | null): number {
  const desde = ultimoDelCliente?.getTime() ?? 0;
  return fechas.filter((fecha) => fecha.getTime() > desde).length + 1;
}

/**
 * Hasta 3 propuestas de la IA: si una no pasa la revision, se le devuelven los problemas y se le pide
 * otra. Termina en la primera que pasa (o si la IA no responde).
 */
async function pedirPropuestas(
  apiKey: string,
  pedido: { instrucciones: string; contexto: string },
  revision: RevisionDelSeguimiento,
): Promise<string[]> {
  const propuestas: string[] = [];
  const mensajes: MensajeDelModelo[] = [{ role: "user", content: pedido.contexto }];
  for (let intento = 0; intento < INTENTOS_MAXIMOS; intento += 1) {
    const respuesta = await pedirAlModelo(apiKey, pedido.instrucciones, mensajes);
    if (!respuesta) break;
    const texto = limpiarRespuesta(respuesta);
    if (!texto) break;
    propuestas.push(texto);
    const problemas = revisarSeguimiento(texto, revision);
    if (!problemas.length) break;
    mensajes.push(
      { role: "assistant", content: respuesta },
      {
        role: "user",
        content: `Ese mensaje no cumple:\n${problemas.map((p) => `- ${p}`).join("\n")}\n\nEscribe otro que cumpla todas las reglas. Solo el texto del mensaje.`,
      },
    );
  }
  return propuestas;
}

/**
 * Sin comillas alrededor y con la negrita de WhatsApp (un solo asterisco por lado): cualquier grupo de
 * 2 o mas asteriscos queda en uno, asi "**camilla**" y "***50 %***" salen "*camilla*" y "*50 %*".
 */
function limpiarRespuesta(texto: string): string {
  return texto
    .trim()
    .replace(/^["“'«]+|["”'»]+$/g, "")
    .replace(/\*{2,}/g, "*")
    .trim();
}

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
    return datos.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.warn("[seguimiento-que-escucha] fallo la llamada", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/* ------------------------------------------------------------------------------------------------
   Lo que se lee de la base
------------------------------------------------------------------------------------------------ */

type MensajeLeido = {
  id: string;
  direction: string;
  type: string;
  content: string | null;
  mediaUrl: string | null;
  transcripcion: string | null;
  transcritoEn: Date | null;
  createdAt: Date;
};

/**
 * La conversacion completa, en orden, como la leeria una persona (igual que la sugerencia de
 * respuesta, pero con todos los mensajes). Las notas de voz sin texto se transcriben aqui mismo.
 */
async function leerConversacion(workspaceId: string, conversationId: string) {
  const chat = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
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
          createdAt: true,
        },
      },
    },
  });
  if (!chat) return null;

  const mensajes = [...(chat.messages as MensajeLeido[])].reverse();
  await transcribirLosQueFaltan(mensajes);

  const entrantes = mensajes.filter((m) => m.direction === "INBOUND" && m.type !== "SYSTEM");
  const primerEntrante = entrantes[0]?.createdAt ?? null;
  const ultimoEntrante = entrantes[entrantes.length - 1]?.createdAt ?? null;
  const entrantesDespuesDelAnuncio = primerEntrante
    ? entrantes.filter((m) => m.createdAt.getTime() > primerEntrante.getTime() + VENTANA_DEL_ANUNCIO_MS).length
    : 0;

  return {
    productoId: idDelProducto(chat.activeProductContext),
    lineas: aLineas(mensajes),
    ultimoDelCliente: ultimoEntrante,
    soloMandoElAnuncio: soloMandoElAnuncio({ primerEntrante, ultimoEntrante, entrantesDespuesDelAnuncio, automaticos: [] }),
  };
}

/**
 * Las notas de voz que el reloj todavia no paso a texto (las mas nuevas primero). Se guarda el texto
 * en el mensaje, como lo hace el reloj, para no pagarlas dos veces. Si una no se puede, sigue sin ella.
 */
async function transcribirLosQueFaltan(mensajes: MensajeLeido[]) {
  const pendientes = mensajes
    .filter((m) => m.type === "AUDIO" && !m.transcripcion?.trim() && !m.transcritoEn && m.mediaUrl?.trim())
    .slice(-AUDIOS_AL_MOMENTO);
  for (const mensaje of pendientes) {
    const texto = await transcribirAudioAhora(mensaje.mediaUrl!).catch(() => null);
    if (!texto) continue;
    mensaje.transcripcion = texto;
    await prisma.message
      .updateMany({
        where: { id: mensaje.id, transcripcion: null, transcritoEn: null },
        data: { transcripcion: texto, transcritoEn: new Date() },
      })
      .catch(() => null);
  }
}

function idDelProducto(contexto: unknown) {
  const id = (contexto as ActiveProductContext | null | undefined)?.productId;
  return typeof id === "string" && id ? id : null;
}

/** Los mensajes como lineas de texto. Sin avisos del sistema ni notas internas. */
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

/** Los origenes de los seguimientos automaticos de texto: los follows y los del reloj del V3 (parte 3). */
const ORIGENES_DE_SEGUIMIENTO = ["follow", "agente-v3-seguimiento", "agente-v3-seguimiento-ia"];

/** Los seguimientos que ya le llegaron a este chat (texto y fecha). */
async function seguimientosYaEnviados(conversationId: string) {
  const filas = await prisma.message.findMany({
    where: {
      conversationId,
      direction: "OUTBOUND",
      deletedAt: null,
      OR: ORIGENES_DE_SEGUIMIENTO.map((source) => ({ rawPayload: { path: ["source"], equals: source } })),
    },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { content: true, createdAt: true },
  });
  return {
    textos: filas.map((fila) => fila.content?.trim() || "").filter(Boolean),
    fechas: filas.map((fila) => fila.createdAt),
  };
}

const PESOS = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

/** El producto del chat, SIN costo ni mayorista. null si no hay o esta inactivo. */
async function leerProducto(workspaceId: string, productoId: string | null) {
  if (!productoId) return null;
  const producto = await prisma.product
    .findFirst({
      where: { id: productoId, workspaceId },
      select: { name: true, price: true, description: true, activo: true },
    })
    .catch(() => null);
  if (!producto || !producto.activo) return null;
  const precio = Number(producto.price);
  return {
    nombre: producto.name,
    precio: precio > 0 ? PESOS.format(precio) : null,
    descripcion: producto.description?.trim().slice(0, 1_500) || null,
  };
}
