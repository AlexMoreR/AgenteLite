import { leerLibro } from "@/features/agente-v3/servicios/almacen";
import { soloMandoElAnuncio, VENTANA_DEL_ANUNCIO_MS } from "@/lib/anti-bloqueo/reglas";
import { esNotaInternaDelAgente } from "@/lib/notas-internas-del-agente";
import { prisma } from "@/lib/prisma";
import { transcribirAudioAhora } from "@/lib/transcripcion-de-audios";

import {
  armarPedido,
  armarSistema,
  CLAVE_APAGADO,
  leerTextoDelModelo,
  preguntaDelProducto,
  revisarSeguimiento,
  type LineaDelChat,
  type ProductoDelSeguimiento,
} from "../dominio/seguimiento-que-escucha";

/**
 * EL REDACTOR DE SEGUIMIENTOS (Alex, 26-10-2026): "Si el cliente se siente escuchado, tiene
 * intención de compra".
 *
 * Justo antes de mandar un seguimiento automático de texto, lee la conversación completa (con los
 * audios ya pasados a texto) y escribe uno que menciona lo que ESE cliente dijo. No cambia cuándo
 * sale ni cuántos salen: los frenos (anti-bloqueo, freno de 3 sin respuesta, turno, pausas) corren
 * ANTES y este redactor solo cambia el texto del que ya iba a salir.
 *
 * Qué pasa según el caso (el resultado tiene siempre un `origen` para anotar y medir):
 *  - interruptor apagado o sin clave de OpenAI -> sale el texto de siempre, sin tocarlo;
 *  - la IA escribe y la revisión lo aprueba   -> sale el nuevo;
 *  - la IA falla o nada pasa la revisión      -> el texto de siempre si pasa la revisión; si no, la pregunta
 *                                               corta del producto; si no hay producto, no se manda;
 *  - demasiados en esta vuelta                -> se difiere a la vuelta siguiente (cada una redacta pocos).
 */

const MODELO = "gpt-4.1-mini";
const PLAZO_MS = 25_000;
const MENSAJES_DE_CONTEXTO = 40;
const AUDIOS_A_TRANSCRIBIR = 3;
/** Redacciones con IA por minuto (la vuelta del reloj). Los que no alcanzan salen en la vuelta siguiente. */
export const MAXIMO_POR_VUELTA = 8;
const REINTENTOS = 2;

const PESOS = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

export type ResultadoDelRedactor =
  | { origen: "apagado" }
  | { origen: "ia"; texto: string; reemplaza: string }
  | { origen: "respaldo"; texto: string }
  | { origen: "pregunta_del_producto"; texto: string; reemplaza: string }
  | { origen: "diferir" }
  | { origen: "omitir"; motivo: string };

export type MarcaDelSeguimiento = {
  origen: "ia" | "pregunta_del_producto";
  reemplaza: string;
};

/** Lo que queda en el mensaje enviado (rawPayload.seguimientoIa) para medir cuántos contestan. */
export function marcaDelResultado(resultado: ResultadoDelRedactor): MarcaDelSeguimiento | null {
  if (resultado.origen === "ia" || resultado.origen === "pregunta_del_producto") {
    return { origen: resultado.origen, reemplaza: resultado.reemplaza };
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------
   Tope por vuelta
------------------------------------------------------------------------------------------------ */

let vueltaActual = { minuto: 0, usados: 0 };

function haySitio(ahora: Date) {
  const minuto = Math.floor(ahora.getTime() / 60_000);
  if (vueltaActual.minuto !== minuto) vueltaActual = { minuto, usados: 0 };
  if (vueltaActual.usados >= MAXIMO_POR_VUELTA) return false;
  vueltaActual.usados += 1;
  return true;
}

/** Para las pruebas. */
export function reiniciarTopeDeLaVuelta() {
  vueltaActual = { minuto: 0, usados: 0 };
}

/* ------------------------------------------------------------------------------------------------
   El núcleo, sin base: decide el texto con los datos que ya se leyeron
------------------------------------------------------------------------------------------------ */

export type DatosDelChat = {
  lineas: LineaDelChat[];
  yaEnviados: string[];
  enviado: string;
  nombre: string | null;
  producto: ProductoDelSeguimiento | null;
  comoHablamos: string;
  soloAnuncio: boolean;
};

export type PedirAlModelo = (sistema: string, mensajes: Array<{ role: "user" | "assistant"; content: string }>) => Promise<string | null>;

export async function decidirTextoDelSeguimiento(input: {
  datos: DatosDelChat;
  textoDeSiempre: string;
  pedir: PedirAlModelo;
}): Promise<ResultadoDelRedactor> {
  const { datos, textoDeSiempre, pedir } = input;
  const contexto = [
    datos.comoHablamos,
    datos.producto ? `${datos.producto.nombre} ${datos.producto.codigo ?? ""} ${datos.producto.precio} ${datos.producto.descripcion ?? ""}` : "",
    datos.lineas.map((linea) => linea.texto).join("\n"),
  ].join("\n");
  const revisar = (texto: string) =>
    revisarSeguimiento(texto, {
      contexto,
      yaEnviados: datos.yaEnviados,
      precioMayorista: datos.producto?.precioMayorista ?? null,
    });

  const sistema = armarSistema({ comoHablamos: datos.comoHablamos, producto: datos.producto, soloAnuncio: datos.soloAnuncio });
  const pedido = armarPedido({ lineas: datos.lineas, yaEnviados: datos.yaEnviados, nombre: datos.nombre, enviado: datos.enviado });

  let respuesta = await pedir(sistema, [{ role: "user", content: pedido }]);
  for (let intento = 0; respuesta && intento <= REINTENTOS; intento += 1) {
    const texto = leerTextoDelModelo(respuesta);
    const problemas = revisar(texto);
    if (texto && problemas.length === 0) return { origen: "ia", texto, reemplaza: textoDeSiempre };
    if (intento === REINTENTOS) break;
    respuesta = await pedir(sistema, [
      { role: "user", content: pedido },
      { role: "assistant", content: respuesta },
      {
        role: "user",
        content: `Ese mensaje no cumple estas reglas:\n${(problemas.length ? problemas : ["está vacío"]).map((p) => `- ${p}`).join("\n")}\n\nReescríbelo cumpliéndolas todas. Responde SOLO un JSON: {"texto": "<el mensaje>"}`,
      },
    ]);
  }

  // La IA falló o ningún texto pasó la revisión: el de siempre, solo si también la pasa.
  if (revisar(textoDeSiempre).length === 0) return { origen: "respaldo", texto: textoDeSiempre };

  const pregunta = preguntaDelProducto(datos.producto, datos.yaEnviados, datos.nombre);
  if (pregunta && revisar(pregunta).length === 0) {
    return { origen: "pregunta_del_producto", texto: pregunta, reemplaza: textoDeSiempre };
  }
  return { origen: "omitir", motivo: datos.producto ? "sin_texto_aceptable" : "sin_texto_ni_producto" };
}

/* ------------------------------------------------------------------------------------------------
   Lo que lee de la base
------------------------------------------------------------------------------------------------ */

async function pedirAOpenAI(apiKey: string, sistema: string, mensajes: Array<{ role: "user" | "assistant"; content: string }>) {
  try {
    const respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(PLAZO_MS),
      body: JSON.stringify({
        model: MODELO,
        temperature: 0.5,
        response_format: { type: "json_object" },
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

function haceCuanto(fecha: Date, ahora: Date) {
  const minutos = Math.max(0, Math.round((ahora.getTime() - new Date(fecha).getTime()) / 60_000));
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return `hace ${dias} ${dias === 1 ? "día" : "días"}`;
}

const ORIGENES_DE_SEGUIMIENTO = ["follow", "agente-v3-seguimiento", "agente-v3-seguimiento-ia"];

async function leerElChat(input: {
  workspaceId: string;
  contactId: string;
  channelId: string | null;
  conversationId?: string | null;
  ahora: Date;
}): Promise<DatosDelChat | null> {
  const conversacion = await prisma.conversation.findFirst({
    where: input.conversationId
      ? { id: input.conversationId, workspaceId: input.workspaceId }
      : {
          workspaceId: input.workspaceId,
          contactId: input.contactId,
          ...(input.channelId ? { channelId: input.channelId } : {}),
        },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, activeProductContext: true, contact: { select: { name: true } } },
  });
  if (!conversacion) return null;

  const [recientes, entrantes, enviadosFilas, archivos] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: conversacion.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: MENSAJES_DE_CONTEXTO,
      select: { id: true, direction: true, type: true, content: true, mediaUrl: true, transcripcion: true, createdAt: true },
    }),
    prisma.message.findMany({
      where: { conversationId: conversacion.id, direction: "INBOUND", deletedAt: null },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { createdAt: true },
    }),
    prisma.message.findMany({
      where: {
        conversationId: conversacion.id,
        direction: "OUTBOUND",
        deletedAt: null,
        OR: ORIGENES_DE_SEGUIMIENTO.map((origen) => ({ rawPayload: { path: ["source"], equals: origen } })),
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { content: true },
    }),
    prisma.message.findMany({
      where: { conversationId: conversacion.id, direction: "OUTBOUND", mediaUrl: { not: null }, deletedAt: null },
      select: { type: true },
      take: 300,
    }),
  ]);

  // Los audios que el reloj todavía no pasó a texto se pasan ahora (los más nuevos primero).
  let pendientes = AUDIOS_A_TRANSCRIBIR;
  for (const mensaje of recientes) {
    if (pendientes <= 0) break;
    if (mensaje.type !== "AUDIO" || mensaje.transcripcion?.trim() || !mensaje.mediaUrl) continue;
    pendientes -= 1;
    const texto = await transcribirAudioAhora(mensaje.mediaUrl);
    if (texto) {
      mensaje.transcripcion = texto;
      await prisma.message
        .updateMany({ where: { id: mensaje.id, transcripcion: null }, data: { transcripcion: texto, transcritoEn: new Date() } })
        .catch(() => null);
    }
  }

  const lineas: LineaDelChat[] = [...recientes]
    .reverse()
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
        hace: haceCuanto(m.createdAt, input.ahora),
      };
    })
    .filter((linea) => linea.texto);

  const primerEntrante = entrantes[0]?.createdAt ?? null;
  const soloAnuncio = soloMandoElAnuncio({
    primerEntrante,
    ultimoEntrante: entrantes[entrantes.length - 1]?.createdAt ?? null,
    entrantesDespuesDelAnuncio: primerEntrante
      ? entrantes.filter((e) => e.createdAt.getTime() - primerEntrante.getTime() > VENTANA_DEL_ANUNCIO_MS).length
      : 0,
    automaticos: [],
  });

  const productoId = (conversacion.activeProductContext as { productId?: unknown } | null)?.productId;
  const producto =
    typeof productoId === "string" && productoId
      ? await prisma.product
          .findFirst({
            where: { id: productoId, workspaceId: input.workspaceId },
            // A proposito SIN costo ni margenes. El mayorista se lee solo para comprobar que no se filtre.
            select: { name: true, code: true, price: true, description: true, wholesalePrice: true, activo: true },
          })
          .catch(() => null)
      : null;
  const libro = await leerLibro(input.workspaceId).catch(() => null);

  const cuantos = (tipo: string) => archivos.filter((archivo) => archivo.type === tipo).length;
  const enviado = [cuantos("IMAGE") ? `${cuantos("IMAGE")} fotos` : "", cuantos("VIDEO") ? `${cuantos("VIDEO")} videos` : "", cuantos("DOCUMENT") ? `${cuantos("DOCUMENT")} documentos` : ""]
    .filter(Boolean)
    .join(", ");

  const mayorista = producto ? Number(producto.wholesalePrice) : 0;
  return {
    lineas,
    yaEnviados: enviadosFilas.map((fila) => fila.content?.trim() ?? "").filter(Boolean),
    enviado,
    nombre: conversacion.contact?.name?.trim().split(/\s+/)[0] || null,
    producto:
      producto && producto.activo
        ? {
            nombre: producto.name,
            codigo: producto.code,
            precio: PESOS.format(Number(producto.price)),
            descripcion: producto.description?.trim() || null,
            precioMayorista: mayorista > 0 ? mayorista : null,
          }
        : null,
    comoHablamos: libro?.comoHablamos?.trim() || "",
    soloAnuncio,
  };
}

/**
 * Lo que llaman los dos puntos de envío (follows.ts y el reloj del V3). Nunca lanza: ante cualquier
 * error sale el texto de siempre, como antes de existir el redactor.
 */
export async function redactarSeguimiento(input: {
  workspaceId: string;
  contactId: string;
  channelId: string | null;
  conversationId?: string | null;
  textoDeSiempre: string;
  ahora?: Date;
}): Promise<ResultadoDelRedactor> {
  const ahora = input.ahora ?? new Date();
  try {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return { origen: "apagado" };

    const apagado = await prisma.appSetting.findUnique({ where: { key: CLAVE_APAGADO }, select: { value: true } });
    if (apagado?.value?.trim().toLowerCase() === "si") return { origen: "apagado" };

    if (!haySitio(ahora)) return { origen: "diferir" };

    const datos = await leerElChat({ ...input, ahora });
    if (!datos) return { origen: "apagado" };
    return await decidirTextoDelSeguimiento({
      datos,
      textoDeSiempre: input.textoDeSiempre,
      pedir: (sistema, mensajes) => pedirAOpenAI(apiKey, sistema, mensajes),
    });
  } catch (error) {
    console.error("[seguimiento-que-escucha] fallo; sale el texto de siempre", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { origen: "apagado" };
  }
}
