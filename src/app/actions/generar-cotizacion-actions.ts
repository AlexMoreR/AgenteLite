"use server";

import { auth } from "@/auth";
import { leerFichaDeCotizacionAction } from "@/app/actions/quote-data-actions";
import { registrarCotizacion } from "@/features/embudo/servicios/eventos";
import {
  armarPedidoDeCotizacion,
  CLAVE_ASESORAS_GESTION,
  correoDeLaAsesoraEnGestion,
  type CreadaPor,
  leerRespuestaDeGestion,
  type Faltante,
  type LineaElegida,
  type ProductoDelCatalogo,
} from "@/features/cotizaciones/services/generar-cotizacion";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { crearCotizacionEnGestion } from "@/lib/cotizacion-en-gestion";
import { moverEtapaAutomatica } from "@/lib/etapa-automatica-crm";
import { origenDelContacto } from "@/lib/origen-de-venta-crm";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

/**
 * "Generar cotizacion" de la pestaña Cotizaciones del chat: crea la cotizacion en Gestion con la
 * ficha guardada del cliente y los productos elegidos. Permiso: el mismo de ver el chat.
 * Los datos del cliente se leen de la base (no del navegador) y Gestion pone los precios.
 */

async function sesionConNegocio() {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return null;
  }
  await requireClientWorkspaceAccess("chats");
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return null;
  }
  return { user: session.user, workspaceId: membership.workspace.id };
}

/** Productos que se pueden cotizar: los del catalogo (los de Gestion son los que sirven). */
export async function listarProductosParaCotizarAction(): Promise<{ productos?: ProductoDelCatalogo[]; error?: string }> {
  const ctx = await sesionConNegocio();
  if (!ctx) {
    return { error: "No autorizado" };
  }
  const filas = await prisma.product.findMany({
    where: { workspaceId: ctx.workspaceId, activo: true, origen: "GESTION", code: { not: null } },
    select: { id: true, code: true, name: true, price: true, origen: true, activo: true },
    orderBy: { name: "asc" },
    take: 1000,
  });
  return {
    productos: filas.map((fila) => ({
      id: fila.id,
      codigo: fila.code,
      nombre: fila.name,
      precio: Number(fila.price),
      origen: fila.origen,
      activo: fila.activo,
    })),
  };
}

export type ResultadoDeGenerar =
  | {
      ok: true;
      reutilizada: boolean;
      codigo: string;
      total: number;
      shareUrl: string;
      pdfUrl: string | null;
      creadaPor: CreadaPor | null;
    }
  | { ok: false; faltantes?: Faltante[]; error?: string };

export async function generarCotizacionEnGestionAction(input: {
  contactId: string;
  conversationId?: string;
  lineas: LineaElegida[];
}): Promise<ResultadoDeGenerar> {
  const ctx = await sesionConNegocio();
  if (!ctx) {
    return { ok: false, error: "No autorizado" };
  }

  const contacto = await prisma.contact.findFirst({
    where: { id: input.contactId, workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  if (!contacto) {
    return { ok: false, error: "No autorizado" };
  }
  // El chat abierto, solo si es de este contacto y de este negocio (para la nota y el embudo).
  const conversacion = input.conversationId
    ? await prisma.conversation.findFirst({
        where: { id: input.conversationId, workspaceId: ctx.workspaceId, contactId: contacto.id },
        select: { id: true, channelId: true },
      })
    : null;

  const lineas = (Array.isArray(input.lineas) ? input.lineas : [])
    .slice(0, 50)
    .map((linea) => ({ productId: String(linea?.productId ?? ""), cantidad: Number(linea?.cantidad) }));

  const [ficha, catalogo, origen, mapaAsesoras] = await Promise.all([
    leerFichaDeCotizacionAction(contacto.id),
    prisma.product.findMany({
      where: { workspaceId: ctx.workspaceId, id: { in: lineas.map((linea) => linea.productId) } },
      select: { id: true, code: true, name: true, price: true, origen: true, activo: true },
    }),
    origenDelContacto(ctx.workspaceId, contacto.id, "cotizacion"),
    // Cuenta de Gestion de la asesora (mapa fijo; si no esta, su propio correo).
    prisma.appSetting
      .findUnique({ where: { key: `${CLAVE_ASESORAS_GESTION}${ctx.workspaceId}` }, select: { value: true } })
      .catch(() => null),
  ]);
  if (!ficha.datos) {
    return { ok: false, error: ficha.error ?? "No se pudo leer la ficha" };
  }

  const armado = armarPedidoDeCotizacion({
    ficha: ficha.datos.ficha,
    lineas,
    catalogo: catalogo.map((fila) => ({
      id: fila.id,
      codigo: fila.code,
      nombre: fila.name,
      precio: Number(fila.price),
      origen: fila.origen,
      activo: fila.activo,
    })),
    telefono: origen.telefono,
    asesoraEmail: correoDeLaAsesoraEnGestion(mapaAsesoras?.value, ctx.user.id, ctx.user.email),
    origen: origen.origin,
    linea: origen.linea,
    conversationId: input.conversationId ?? null,
    contactId: contacto.id,
  });
  if (!armado.ok) {
    return { ok: false, faltantes: armado.faltantes };
  }

  const envio = await crearCotizacionEnGestion(ctx.workspaceId, armado.pedido);
  if (!envio.ok) {
    return { ok: false, error: envio.error };
  }
  const respuesta = leerRespuestaDeGestion(envio.status, envio.cuerpo);
  if (respuesta.tipo === "faltan") {
    return { ok: false, faltantes: respuesta.faltantes };
  }
  if (respuesta.tipo === "error") {
    console.warn("[cotizacion-gestion] rechazada", { contactId: contacto.id, status: envio.status });
    return { ok: false, error: respuesta.mensaje };
  }

  if (conversacion && !respuesta.reutilizada) {
    await recordConversationActivity({
      workspaceId: ctx.workspaceId,
      conversationId: conversacion.id,
      channelId: conversacion.channelId,
      contactId: contacto.id,
      kind: "note",
      text: `Cotización ${respuesta.codigo} generada en Gestión`,
      actorUserId: ctx.user.id,
      origen: "generar-cotizacion",
    });
  }
  if (conversacion) {
    registrarCotizacion({
      workspaceId: ctx.workspaceId,
      conversationId: conversacion.id,
      contactId: contacto.id,
      channelId: conversacion.channelId,
      cotizacion: respuesta.codigo,
      actorUserId: ctx.user.id,
    });
  }
  /*
    Cotizar desde el chat pasa el lead a Caliente (ver etapa-automatica-crm.ts). Para mandar una
    cotización primero hay que crearla, así que este es el momento. Vale para las dos líneas.

    Desde el chat llega la CLAVE ("agent:<id>" u "official:<id>"), no el id a secas. El chat tiene
    que ser de este contacto: así nadie mueve la etapa de otro pasando un id a mano.
  */
  const claveDelChat = input.conversationId?.trim() ?? "";
  const esOficial = claveDelChat.startsWith("official:");
  const idDelChat = claveDelChat.replace(/^(agent|official):/, "");
  const esDelContacto = !idDelChat
    ? false
    : esOficial
      ? (await prisma.officialApiConversation
          .count({
            where: { id: idDelChat, config: { workspaceId: ctx.workspaceId }, contact: { crmContactId: contacto.id } },
          })
          .catch(() => 0)) > 0
      : (await prisma.conversation
          .count({ where: { id: idDelChat, workspaceId: ctx.workspaceId, contactId: contacto.id } })
          .catch(() => 0)) > 0;
  if (esDelContacto) {
    await moverEtapaAutomatica({
      workspaceId: ctx.workspaceId,
      chat: { source: esOficial ? "official" : "agent", conversationId: idDelChat },
      motivo: { tipo: "cotizacion", codigo: respuesta.codigo },
    });
  }

  return {
    ok: true,
    reutilizada: respuesta.reutilizada,
    codigo: respuesta.codigo,
    total: respuesta.total,
    shareUrl: respuesta.shareUrl,
    pdfUrl: respuesta.pdfUrl,
    creadaPor: respuesta.creadaPor,
  };
}
