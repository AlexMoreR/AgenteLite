import { Prisma } from "@prisma/client";

import { registrarAlerta } from "@/features/alertas/servicios/alertas";
import { getPublicBaseUrl } from "@/lib/app-url";
import { persistChatMediaFromDataUrl } from "@/lib/chat-media-storage";
import { sendEvolutionDocumentMessage, sendEvolutionMediaBase64, sendEvolutionMediaUrl } from "@/lib/evolution";
import { persistEvolutionMessage } from "@/lib/evolution-envio";
import { variantesDeTelefono } from "@/lib/origen-de-venta";
import {
  comoSeManda,
  procesarPago,
  type DependenciasDelEnvio,
  type ModoDelPago,
  type PagoAProveedora,
  type ResultadoDelEnvio,
} from "@/lib/pago-a-proveedora";
import { prisma } from "@/lib/prisma";
import { taparNumeros, telefonoTapado } from "@/lib/recibo-de-caja";
import { LINEA_ADMIN_RECIBOS } from "@/lib/recibo-de-caja-envio";

/**
 * EL ENVÍO DEL AVISO DE PAGO A PROVEEDORA (del servidor). La decisión (modo, teléfono de prueba, no
 * mandar dos veces, alertas) está en `pago-a-proveedora.ts`; aquí solo están las piezas de verdad: la
 * base, el WhatsApp de la línea Admin y la alerta. Copiado del molde de `recibo-de-caja-envio.ts`
 * (sin tocarlo), con la diferencia de que el comprobante puede ser PDF o foto.
 *
 * Nunca escribe en el log la llave, el comprobante ni el teléfono completo.
 */

/** La misma línea Admin por la que salen los recibos de caja (no la de ventas). */
const LINEA_ADMIN = LINEA_ADMIN_RECIBOS;

/** El área de /cliente/alertas sale del origen (ver `areaDelOrigen`). */
const ORIGEN_ALERTA = "Gestión";

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

/**
 * El contacto del teléfono en este negocio. Si no existe se crea FUERA del embudo de ventas
 * (`excludedFromCrm`), como el webhook hace con los contactos nuevos de la línea Admin. A uno que ya
 * existe no se le cambia nada.
 */
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
      data: { workspaceId, name: nombre, phoneNumber: telefono, excludedFromCrm: true, metadata: { source: "pago a proveedora" } },
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
 * Manda el comprobante con el texto como pie por la línea Admin y lo deja en el chat. Lanza si NO salió.
 *
 * La línea descarga los archivos desde un link público: el comprobante se guarda en /uploads/chat-media/
 * (así también se ve en el chat) y se manda su link completo. Si eso falla, se manda en base64.
 * Un PDF sale como documento y una foto como imagen.
 */
async function enviarPorLaLineaAdmin(
  workspaceId: string,
  pedido: { telefono: string; texto: string; pago: PagoAProveedora; modo: ModoDelPago },
): Promise<void> {
  const { pago, telefono, texto } = pedido;
  const canal = await prisma.whatsAppChannel.findFirst({
    where: { id: LINEA_ADMIN, workspaceId },
    select: { id: true, agentId: true, evolutionInstanceName: true },
  });
  const instancia = canal?.evolutionInstanceName?.trim();
  if (!canal || !instancia) throw new Error("La línea Admin no existe en este negocio o no tiene instancia de WhatsApp");

  // En PRUEBA el contacto es el del teléfono de prueba (el dueño): no se crea la ficha de la proveedora.
  const nombre = pedido.modo === "PRUEBA" ? "Prueba pagos a proveedoras" : pago.proveedora.nombre;
  const contacto = await contactoPorTelefono(workspaceId, telefono, nombre);
  const conversacion = await conversacionEnLaLinea({ workspaceId, channelId: canal.id, contactId: contacto.id, agentId: canal.agentId });

  const forma = comoSeManda(pago.tipoComprobante);
  const rutaDelArchivo = await persistChatMediaFromDataUrl({
    dataUrl: `data:${forma.mimetype};base64,${pago.comprobanteBase64}`,
    mediaType: forma.tipoMensaje,
  }).catch(() => null);
  // El mismo link público que usa el chat al mandar archivos.
  const base = (process.env.NEXT_PUBLIC_APP_URL?.trim() || getPublicBaseUrl()).replace(/\/+$/, "");
  const linkDelArchivo = rutaDelArchivo && base ? `${base}${rutaDelArchivo}` : null;

  let salida: Awaited<ReturnType<typeof sendEvolutionMediaBase64>>;
  try {
    if (!linkDelArchivo) throw new Error("sin link público del comprobante");
    salida =
      forma.mediatype === "document"
        ? await sendEvolutionDocumentMessage({
            instanceName: instancia,
            phoneNumber: telefono,
            documentUrl: linkDelArchivo,
            caption: texto,
            fileName: pago.nombreArchivo,
            delayMs: 0,
          })
        : await sendEvolutionMediaUrl({
            instanceName: instancia,
            phoneNumber: telefono,
            mediatype: "image",
            mimetype: forma.mimetype,
            url: linkDelArchivo,
            fileName: pago.nombreArchivo,
            caption: texto,
            delayMs: 0,
          });
  } catch (errorDelLink) {
    console.warn("[pago-a-proveedora] el link no salió, se prueba en base64", {
      pagoId: pago.pagoId,
      telefono: telefonoTapado(telefono),
      // El error crudo del gateway puede repetir el número: se tapa antes del log.
      detalle: errorDelLink instanceof Error ? taparNumeros(errorDelLink.message).slice(0, 200) : "desconocido",
    });
    salida = await sendEvolutionMediaBase64({
      instanceName: instancia,
      phoneNumber: telefono,
      mediatype: forma.mediatype,
      mimetype: forma.mimetype,
      base64: pago.comprobanteBase64,
      fileName: pago.nombreArchivo,
      caption: texto,
      delayMs: 0,
    });
  }

  /*
    A esta altura WhatsApp YA lo entregó. Si guardar en el chat falla, se deja el rastro y NO se lanza:
    lanzar haría que Gestión lo reintente y a la proveedora le llegaría el aviso dos veces.
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
        type: forma.tipoMensaje,
        status: "SENT",
        content: texto,
        mediaUrl: rutaDelArchivo,
        sentAt: ahora,
        rawPayload: {
          source: "pago-a-proveedora",
          pagoId: pago.pagoId,
          ofCodigo: pago.ofCodigo,
          modo: pedido.modo,
          fileName: pago.nombreArchivo,
          mimeType: forma.mimetype,
          evolution: (salida?.raw ?? null) as Prisma.InputJsonValue,
        } as Prisma.InputJsonValue,
      },
    });
    await prisma.conversation.update({ where: { id: conversacion.id }, data: { lastMessageAt: ahora, status: "OPEN" } });
  } catch (error) {
    console.error("[pago-a-proveedora] el aviso SÍ salió pero no se pudo guardar en el chat", {
      pagoId: pago.pagoId,
      detalle: error instanceof Error ? taparNumeros(error.message).slice(0, 200) : "desconocido",
    });
  }
}

/** Las piezas de verdad para `procesarPago`. */
export function dependenciasDelEnvio(workspaceId: string): DependenciasDelEnvio {
  return {
    leerAjuste,
    apartar,
    guardarAjuste,
    soltar,
    enviar: (pedido) => enviarPorLaLineaAdmin(workspaceId, pedido),
    // Sin `destinatarioId`: es del negocio y la ven el dueño y los administradores (decisión del plan).
    alertar: async ({ clave, titulo, detalle }) => {
      await registrarAlerta({ workspaceId, clave, prioridad: "ALTA", titulo, detalle, origen: ORIGEN_ALERTA });
    },
  };
}

export async function enviarPagoAProveedora(workspaceId: string, pago: PagoAProveedora): Promise<ResultadoDelEnvio> {
  const resultado = await procesarPago(workspaceId, pago, dependenciasDelEnvio(workspaceId));
  console.info("[pago-a-proveedora]", { pagoId: pago.pagoId, ofCodigo: pago.ofCodigo, estado: resultado.estado, modo: resultado.modo });
  return resultado;
}
