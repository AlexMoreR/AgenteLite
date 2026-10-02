import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { enmascararSiEsTelefono, enmascararTelefono, estaEnModoMonitoreo } from "@/lib/modo-monitoreo";
import { prisma } from "@/lib/prisma";
import {
  canAccessClientModule,
  getClientWorkspaceAccessForUser,
} from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { getVisibleChannelIds } from "@/lib/channel-visibility";
import { getCrmStageLabel } from "@/features/crm/domain/crm-config";

/**
 * Buscador global: una sola caja para toda la app.
 *
 * Antes cada modulo tenia el suyo y habia que adivinar en cual entrar: el telefono de un cliente
 * esta en Chats, en Contactos y en el CRM, y para verlos habia que abrir los tres. Aca se escribe
 * una vez y cada cosa aparece agrupada.
 *
 * Devuelve POCO a proposito (5 por grupo): esto es para SALTAR a algo que ya sabes que existe,
 * no para listar. Si alguien necesita ver todo, esa es la pantalla del modulo.
 */

export const dynamic = "force-dynamic";

const POR_GRUPO = 5;

export type BuscadorResultado = {
  id: string;
  tipo: "chat" | "contacto" | "producto";
  titulo: string;
  detalle: string;
  href: string;
};

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const access = await getClientWorkspaceAccessForUser(session.user.id);
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  const workspaceId = membership?.workspace.id;
  if (!access || !workspaceId) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  // Con una o dos letras cualquier cosa coincide: seria ruido, y una consulta cara por cada tecla.
  if (q.length < 2) {
    return NextResponse.json({ ok: true, resultados: [] });
  }

  const esJefe = membership.role === "OWNER" || membership.role === "ADMIN";
  /*
    El buscador tapa los telefonos igual que la bandeja.

    Sin esto, buscar seria la forma facil de saltearse el modo monitoreo: el numero entero
    aparece en el resultado, al lado del nombre. Ver `modo-monitoreo.ts`.
  */
  const taparTelefonos = await estaEnModoMonitoreo({
    workspaceId: membership.workspace.id,
    userId: session.user.id,
  });
  const canalesVisibles = await getVisibleChannelIds({
    workspaceId,
    userId: session.user.id,
    esJefe,
  });

  const puedeChats = canAccessClientModule(access, "chats");
  const puedeContactos = canAccessClientModule(access, "contacts");
  const puedeProductos = canAccessClientModule(access, "products_v2");

  const [chats, contactos, productos] = await Promise.all([
    puedeChats
      ? prisma.conversation.findMany({
          where: {
            workspaceId,
            ...(canalesVisibles ? { channelId: { in: canalesVisibles } } : {}),
            // Una asesora que no es jefa solo ve lo suyo y lo que no tiene dueño, igual que en la
            // bandeja: el buscador no puede ser la puerta de atras a los chats de otra.
            ...(esJefe ? {} : { OR: [{ assignedToUserId: session.user.id }, { assignedToUserId: null }] }),
            AND: [
              {
                OR: [
                  { contact: { name: { contains: q, mode: "insensitive" } } },
                  { contact: { phoneNumber: { contains: q, mode: "insensitive" } } },
                  { messages: { some: { content: { contains: q, mode: "insensitive" } } } },
                ],
              },
            ],
          },
          orderBy: { lastMessageAt: "desc" },
          take: POR_GRUPO,
          select: {
            id: true,
            contact: { select: { name: true, phoneNumber: true } },
            // La linea: un mismo cliente puede tener un chat en Ventas 1 y otro en Admin, y sin
            // esto el buscador mostraba dos resultados identicos (Alex, 02-10-2026).
            channel: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    puedeContactos
      ? prisma.contact.findMany({
          where: {
            workspaceId,
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { phoneNumber: { contains: q, mode: "insensitive" } },
            ],
          },
          orderBy: { updatedAt: "desc" },
          take: POR_GRUPO,
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            crmStage: true,
            // Las lineas donde tiene chat, solo entre las que esta persona puede ver.
            conversations: {
              where: canalesVisibles ? { channelId: { in: canalesVisibles } } : {},
              select: { channel: { select: { name: true } } },
            },
          },
        })
      : Promise.resolve([]),
    puedeProductos
      ? prisma.product.findMany({
          where: {
            // Solo el catalogo de ESTE negocio (29-09-2026): buscar "planta" no puede traer las
            // del vivero de otro workspace.
            workspaceId: access.workspaceId,
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          },
          orderBy: { name: "asc" },
          take: POR_GRUPO,
          select: { id: true, name: true, price: true },
        })
      : Promise.resolve([]),
  ]);

  const precio = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

  const resultados: BuscadorResultado[] = [
    ...chats.map((chat) => ({
      id: `chat:${chat.id}`,
      tipo: "chat" as const,
      titulo: taparTelefonos
        ? enmascararSiEsTelefono(chat.contact.name?.trim() || chat.contact.phoneNumber)
        : chat.contact.name?.trim() || chat.contact.phoneNumber,
      detalle: [
        taparTelefonos ? enmascararTelefono(chat.contact.phoneNumber) : chat.contact.phoneNumber,
        chat.channel?.name ?? "sin línea",
      ].join(" · "),
      href: `/cliente/chats?chatKey=${encodeURIComponent(`agent:${chat.id}`)}`,
    })),
    ...contactos.map((contacto) => ({
      id: `contacto:${contacto.id}`,
      tipo: "contacto" as const,
      titulo: taparTelefonos
        ? enmascararSiEsTelefono(contacto.name?.trim() || contacto.phoneNumber)
        : contacto.name?.trim() || contacto.phoneNumber,
      detalle: [
        taparTelefonos ? enmascararTelefono(contacto.phoneNumber) : contacto.phoneNumber,
        Array.from(new Set(contacto.conversations.map((cv) => cv.channel?.name).filter(Boolean))).join(", ") ||
          "sin chat",
        // El nombre de la etapa como se ve en la pantalla ("Frio", "Tibio"), no el interno.
        getCrmStageLabel(contacto.crmStage),
      ].join(" · "),
      href: `/cliente/contactos?contactId=${encodeURIComponent(contacto.id)}`,
    })),
    ...productos.map((producto) => ({
      id: `producto:${producto.id}`,
      tipo: "producto" as const,
      titulo: producto.name,
      detalle: precio.format(Number(producto.price)),
      href: `/cliente/productos-v2?productId=${encodeURIComponent(producto.id)}`,
    })),
  ];

  return NextResponse.json({ ok: true, resultados });
}
