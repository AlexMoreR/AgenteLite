import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import { registrarAlerta } from "@/features/alertas/servicios/alertas";
import { getPublicBaseUrl } from "@/lib/app-url";
import { persistChatMediaFromDataUrl } from "@/lib/chat-media-storage";
import { sendEvolutionDocumentMessage, sendEvolutionMediaBase64 } from "@/lib/evolution";
import { ganadoAutomaticoPrendido } from "@/lib/etapa-automatica-crm";
import { persistEvolutionMessage } from "@/lib/evolution-envio";
import { registrarCambioDeEtapa } from "@/lib/historial-etapa";
import { variantesDeTelefono } from "@/lib/origen-de-venta";
import { prisma } from "@/lib/prisma";
import {
  procesarRecibo,
  taparNumeros,
  telefonoTapado,
  type DependenciasDelEnvio,
  type DestinoDelRecibo,
  type ModoDelRecibo,
  type ReciboDeCaja,
  type ResultadoDelEnvio,
} from "@/lib/recibo-de-caja";

/**
 * EL ENVÍO DEL RECIBO DE CAJA (del servidor). La decisión (modo, teléfono de prueba, no mandar dos
 * veces, alerta si falla, cuándo se marca Cliente/GANADO) está en `recibo-de-caja.ts`; aquí solo están
 * las piezas de verdad: la base, el WhatsApp de la línea Admin, el marcado del contacto y las alertas.
 *
 * Nunca escribe en el log la llave, el PDF ni el teléfono completo.
 */

/** La línea Admin de Magilus: por ahí salen los recibos (no por la de ventas). */
export const LINEA_ADMIN_RECIBOS = "cmt06kiob00lw2hk2mgllstsb";

/** El área de /cliente/alertas sale del origen (ver `areaDelOrigen`). */
const ORIGEN_ALERTA = "Gestión";

const MIME_PDF = "application/pdf";

function esDuplicado(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function leerAjuste(clave: string): Promise<string | null> {
  const fila = await prisma.appSetting.findUnique({ where: { key: clave }, select: { value: true } });
  return fila?.value ?? null;
}

async function apartar(clave: string, anterior: string | null, nuevo: string): Promise<boolean> {
  if (anterior === null) {
    try {
      await prisma.appSetting.create({ data: { key: clave, value: nuevo } });
      return true;
    } catch (error) {
      if (esDuplicado(error)) return false; // otro pedido igual lo apartó primero
      throw error;
    }
  }
  // Solo si nadie la cambió desde que se leyó (dos pedidos iguales al mismo tiempo: gana uno).
  const { count } = await prisma.appSetting.updateMany({ where: { key: clave, value: anterior }, data: { value: nuevo } });
  return count === 1;
}

async function guardarAjuste(clave: string, valor: string): Promise<void> {
  await prisma.appSetting.upsert({ where: { key: clave }, create: { key: clave, value: valor }, update: { value: valor } });
}

async function soltar(clave: string, valorApartado: string): Promise<void> {
  // Solo se borra el apartado propio: si otro pedido ya lo marcó, no se toca.
  await prisma.appSetting.deleteMany({ where: { key: clave, value: valorApartado } });
}

/** El contacto del teléfono en este negocio (el CRM guarda "57…", pero puede haber fichas viejas sin 57). */
async function contactoPorTelefono(workspaceId: string, telefono: string, nombre: string) {
  const variantes = variantesDeTelefono(telefono);
  const buscar = () =>
    prisma.contact.findFirst({
      where: { workspaceId, phoneNumber: { in: variantes } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
  const existente = await buscar();
  if (existente) return existente;
  try {
    return await prisma.contact.create({
      data: { workspaceId, name: nombre, phoneNumber: telefono, metadata: { source: "recibo de caja" } },
      select: { id: true },
    });
  } catch (error) {
    // Lo creó otro proceso al mismo tiempo (el webhook, por ejemplo): se usa ese.
    if (esDuplicado(error)) {
      const creado = await buscar();
      if (creado) return creado;
    }
    throw error;
  }
}

/** La conversación del contacto EN LA LÍNEA ADMIN (no la de ventas): se reusa la que haya o se abre una. */
async function conversacionEnLaLinea(input: { workspaceId: string; channelId: string; contactId: string; agentId: string | null }) {
  for (let intento = 0; intento < 3; intento += 1) {
    try {
      const existente = await prisma.conversation.findFirst({
        where: { workspaceId: input.workspaceId, channelId: input.channelId, contactId: input.contactId },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });
      if (existente) return existente;
      return await prisma.conversation.create({
        data: {
          workspaceId: input.workspaceId,
          channelId: input.channelId,
          agentId: input.agentId,
          contactId: input.contactId,
          status: "OPEN",
          lastMessageAt: new Date(),
        },
        select: { id: true },
      });
    } catch (error) {
      if (esDuplicado(error) && intento < 2) {
        await new Promise((resolve) => setTimeout(resolve, 50 * (intento + 1)));
        continue;
      }
      throw error;
    }
  }
  throw new Error("No se pudo abrir la conversación en la línea Admin");
}

/**
 * Manda el PDF con el texto como pie por la línea Admin y lo deja en el chat. Lanza si NO salió.
 *
 * La línea es Evolution GO, que descarga los archivos desde un link público: el PDF se guarda en
 * /uploads/chat-media/ (así también se ve en el chat) y se manda su link completo. Si eso falla, se
 * manda en base64.
 */
async function enviarPorLaLineaAdmin(
  workspaceId: string,
  pedido: { telefono: string; texto: string; recibo: ReciboDeCaja; modo: ModoDelRecibo },
): Promise<DestinoDelRecibo> {
  const { recibo, telefono, texto } = pedido;
  const canal = await prisma.whatsAppChannel.findFirst({
    where: { id: LINEA_ADMIN_RECIBOS, workspaceId },
    select: { id: true, agentId: true, evolutionInstanceName: true },
  });
  const instancia = canal?.evolutionInstanceName?.trim();
  if (!canal || !instancia) throw new Error("La línea Admin no existe en este negocio o no tiene instancia de WhatsApp");

  // En PRUEBA el contacto es el del teléfono de prueba (el dueño): no se le cambia el nombre ni se crea la ficha del cliente.
  const nombre = pedido.modo === "PRUEBA" ? "Prueba recibos de caja" : recibo.cliente.nombre;
  const contacto = await contactoPorTelefono(workspaceId, telefono, nombre);
  const conversacion = await conversacionEnLaLinea({ workspaceId, channelId: canal.id, contactId: contacto.id, agentId: canal.agentId });

  const rutaDelPdf = await persistChatMediaFromDataUrl({ dataUrl: `data:${MIME_PDF};base64,${recibo.pdfBase64}`, mediaType: "DOCUMENT" }).catch(
    () => null,
  );
  // El mismo link público que usa el chat al mandar archivos.
  const base = (process.env.NEXT_PUBLIC_APP_URL?.trim() || getPublicBaseUrl()).replace(/\/+$/, "");
  const linkDelPdf = rutaDelPdf && base ? `${base}${rutaDelPdf}` : null;

  let salida: Awaited<ReturnType<typeof sendEvolutionMediaBase64>>;
  try {
    if (!linkDelPdf) throw new Error("sin link público del PDF");
    salida = await sendEvolutionDocumentMessage({
      instanceName: instancia,
      phoneNumber: telefono,
      documentUrl: linkDelPdf,
      caption: texto,
      fileName: recibo.nombreArchivo,
      delayMs: 0,
    });
  } catch (errorDelLink) {
    console.warn("[recibo-de-caja] el link no salió, se prueba en base64", {
      reciboId: recibo.reciboId,
      telefono: telefonoTapado(telefono),
      // El error crudo del gateway puede repetir el número del cliente: se tapa antes del log.
      detalle: errorDelLink instanceof Error ? taparNumeros(errorDelLink.message).slice(0, 200) : "desconocido",
    });
    salida = await sendEvolutionMediaBase64({
      instanceName: instancia,
      phoneNumber: telefono,
      mediatype: "document",
      mimetype: MIME_PDF,
      base64: recibo.pdfBase64,
      fileName: recibo.nombreArchivo,
      caption: texto,
      delayMs: 0,
    });
  }

  /*
    A esta altura WhatsApp YA lo entregó. Si guardar en el chat falla, se deja el rastro y NO se lanza:
    lanzar haría que Gestión lo reintente y al cliente le llegaría el recibo dos veces.
  */
  try {
    const ahora = new Date();
    await persistEvolutionMessage({
      data: {
        workspaceId,
        conversationId: conversacion.id,
        channelId: canal.id,
        contactId: contacto.id,
        agentId: canal.agentId,
        externalId: salida?.externalId ?? null,
        direction: "OUTBOUND",
        type: "DOCUMENT",
        status: "SENT",
        content: texto,
        mediaUrl: rutaDelPdf,
        sentAt: ahora,
        rawPayload: {
          source: "recibo-de-caja",
          reciboId: recibo.reciboId,
          ventaCodigo: recibo.ventaCodigo,
          modo: pedido.modo,
          fileName: recibo.nombreArchivo,
          mimeType: MIME_PDF,
          evolution: (salida?.raw ?? null) as Prisma.InputJsonValue,
        } as Prisma.InputJsonValue,
      },
    });
    await prisma.conversation.update({ where: { id: conversacion.id }, data: { lastMessageAt: ahora, status: "OPEN" } });
  } catch (error) {
    console.error("[recibo-de-caja] el recibo SÍ salió pero no se pudo guardar en el chat", {
      reciboId: recibo.reciboId,
      detalle: error instanceof Error ? taparNumeros(error.message).slice(0, 200) : "desconocido",
    });
  }
  return { contactId: contacto.id, conversationId: conversacion.id };
}

/* ───────────── Parte 2: el cliente que recibió su recibo queda Cliente / GANADO ───────────── */

const ETIQUETA_CLIENTE = { slug: "cliente", nombre: "Cliente", color: "#16a34a" } as const;

/** La etiqueta "Cliente" del negocio; si no existe se crea (si dos la crean a la vez, se usa la que ganó). */
async function etiquetaCliente(workspaceId: string): Promise<{ id: string }> {
  const buscar = () => prisma.tag.findFirst({ where: { workspaceId, slug: ETIQUETA_CLIENTE.slug }, select: { id: true } });
  const existente = await buscar();
  if (existente) return existente;
  try {
    return await prisma.tag.create({
      data: {
        id: randomUUID(),
        workspaceId,
        name: ETIQUETA_CLIENTE.nombre,
        slug: ETIQUETA_CLIENTE.slug,
        color: ETIQUETA_CLIENTE.color,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
  } catch (error) {
    if (esDuplicado(error)) {
      const creada = await buscar();
      if (creada) return creada;
    }
    throw error;
  }
}

/**
 * Solo se llama en ACTIVO y con el recibo ya entregado (ver `debeMarcarClienteGanado`). Lanza si algo
 * no quedó: `procesarRecibo` lo convierte en una alerta MEDIA y el recibo sigue contado como enviado.
 *
 * - Etiqueta "Cliente": siempre (también si el contacto está fuera del CRM). createMany con
 *   skipDuplicates, como `contact-default-tags.ts`: si ya la tiene no pasa nada ni ensucia el log.
 * - Etapa GANADO: se salta si el contacto tiene `excludedFromCrm`, si ya está en GANADO o si el
 *   interruptor del Ganado automático está apagado (`crm:etapa-automatica:ganado:<negocio>` = off,
 *   el mismo del barrido "Ganado desde Gestión": un solo interruptor apaga todo el Ganado automático).
 *   Es la única excepción a "Ganado lo pone una persona" (ver `marcarCierreDeCompra`): el recibo es
 *   plata ya registrada en Gestión por una asesora.
 */
async function marcarClienteGanado(workspaceId: string, pedido: DestinoDelRecibo & { recibo: ReciboDeCaja }): Promise<void> {
  const contacto = await prisma.contact.findFirst({
    where: { id: pedido.contactId, workspaceId },
    select: { crmStage: true, excludedFromCrm: true, wonAt: true },
  });
  if (!contacto) throw new Error("el contacto del recibo ya no existe");

  const etiqueta = await etiquetaCliente(workspaceId);
  await prisma.contactTag.createMany({
    data: [{ contactId: pedido.contactId, tagId: etiqueta.id, workspaceId }],
    skipDuplicates: true,
  });

  if (contacto.excludedFromCrm || contacto.crmStage === "GANADO") return;
  if (!(await ganadoAutomaticoPrendido(workspaceId))) return;

  const anterior = contacto.crmStage;
  // Solo si sigue en la etapa leída (igual que `marcarGanadoPorGestion`): si alguien lo movió en el medio, no se pisa.
  const guardado = await prisma.contact.updateMany({
    where: { id: pedido.contactId, workspaceId, crmStage: anterior },
    // La fecha de la venta solo si no tenía (no se pisa una puesta a mano).
    data: { crmStage: "GANADO", lostReason: null, ...(contacto.wonAt ? {} : { wonAt: new Date() }) },
  });
  if (guardado.count === 0) throw new Error("la etapa cambió mientras se marcaba GANADO");

  await registrarCambioDeEtapa({
    workspaceId,
    contactId: pedido.contactId,
    conversationId: pedido.conversationId,
    etapaAnterior: anterior,
    etapaNueva: "GANADO",
    origen: "AUTOMATICO",
    nota: `[recibo de caja] venta ${pedido.recibo.ventaCodigo}`,
  });
}

/** Las piezas de verdad para `procesarRecibo`. */
export function dependenciasDelEnvio(workspaceId: string): DependenciasDelEnvio {
  return {
    leerAjuste,
    apartar,
    guardarAjuste,
    soltar,
    enviar: (pedido) => enviarPorLaLineaAdmin(workspaceId, pedido),
    alertar: async ({ clave, titulo, detalle }) => {
      await registrarAlerta({ workspaceId, clave, prioridad: "ALTA", titulo, detalle, origen: ORIGEN_ALERTA });
    },
    marcarCliente: (pedido) => marcarClienteGanado(workspaceId, pedido),
    alertarMedia: async ({ clave, titulo, detalle }) => {
      await registrarAlerta({ workspaceId, clave, prioridad: "MEDIA", titulo, detalle, origen: ORIGEN_ALERTA });
    },
  };
}

export async function enviarReciboDeCaja(workspaceId: string, recibo: ReciboDeCaja): Promise<ResultadoDelEnvio> {
  const resultado = await procesarRecibo(workspaceId, recibo, dependenciasDelEnvio(workspaceId));
  console.info("[recibo-de-caja]", { reciboId: recibo.reciboId, ventaCodigo: recibo.ventaCodigo, estado: resultado.estado, modo: resultado.modo });
  return resultado;
}
