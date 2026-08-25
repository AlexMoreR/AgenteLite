"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

const optionalText = z
  .string()
  .trim()
  .max(200, "Maximo 200 caracteres")
  .transform((value) => value || null)
  .nullish()
  .transform((value) => value ?? null);

const updateContactDetailsSchema = z.object({
  contactId: z.string().trim().min(1),
  firstName: optionalText,
  lastName: optionalText,
  email: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value || null)
    .nullish()
    .transform((value) => value ?? null)
    .refine((value) => value === null || z.string().email().safeParse(value).success, "Correo invalido"),
  city: optionalText,
  country: optionalText,
  tiktok: optionalText,
  facebook: optionalText,
  instagram: optionalText,
});

export type UpdateContactDetailsResult = { ok: true } | { ok: false; error: string };

// Guarda los datos editables del contacto: name/email como columnas y el resto
// dentro de metadata.profile (fusionando metadata para no pisar otras claves,
// p. ej. el estado del avatar).
export async function updateContactDetailsAction(formData: FormData): Promise<UpdateContactDetailsResult> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { ok: false, error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("contacts");

  const parsed = updateContactDetailsSchema.safeParse({
    contactId: formData.get("contactId"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    city: formData.get("city"),
    country: formData.get("country"),
    tiktok: formData.get("tiktok"),
    facebook: formData.get("facebook"),
    instagram: formData.get("instagram"),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Datos invalidos" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return { ok: false, error: "Workspace no encontrado" };
  }

  const contact = await prisma.contact.findFirst({
    where: {
      id: parsed.data.contactId,
      workspaceId: membership.workspace.id,
    },
    select: { id: true, metadata: true },
  });

  if (!contact) {
    return { ok: false, error: "Contacto no encontrado" };
  }

  const existingMetadata =
    contact.metadata && typeof contact.metadata === "object" && !Array.isArray(contact.metadata)
      ? (contact.metadata as Record<string, unknown>)
      : {};

  const fullName = [parsed.data.firstName, parsed.data.lastName].filter(Boolean).join(" ").trim() || null;

  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      name: fullName,
      email: parsed.data.email,
      metadata: {
        ...existingMetadata,
        profile: {
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          city: parsed.data.city,
          country: parsed.data.country,
          tiktok: parsed.data.tiktok,
          facebook: parsed.data.facebook,
          instagram: parsed.data.instagram,
        },
      },
    },
  });

  revalidatePath("/cliente/contactos");
  revalidatePath("/cliente/chats");

  return { ok: true };
}

const createContactSchema = z.object({
  name: z.string().trim().min(1, "Escribi un nombre").max(120, "Nombre demasiado largo"),
  phoneNumber: z.string().trim().min(1, "Escribi un numero de WhatsApp"),
  email: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value || null)
    .nullish()
    .transform((value) => value ?? null)
    .refine((value) => value === null || z.string().email().safeParse(value).success, "Correo invalido"),
});

export type CreateContactResult = { ok: true; contactId: string } | { ok: false; error: string };

/**
 * Normaliza lo que escribio la asesora a como se guardan los numeros.
 *
 * Ella escribe "300 123 4567" o "+57 300 123 4567" indistintamente, y el numero tiene que quedar
 * igual que si el cliente hubiera escrito primero por WhatsApp: si no, queda la misma persona dos
 * veces y la conversacion nunca se junta con la ficha.
 */
function normalizeNewContactPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return null;
  }
  // Celular colombiano sin indicativo: se le antepone el 57, que es como llega desde WhatsApp.
  if (digits.length === 10 && digits.startsWith("3")) {
    return `57${digits}`;
  }
  if (digits.length < 10 || digits.length > 15) {
    return null;
  }
  return digits;
}

/**
 * Alta manual de un contacto.
 *
 * Es para el lead que llega por fuera de WhatsApp (una feria, una llamada, un referido): sin
 * esto habia que esperar a que la persona escribiera primero para poder trabajarla en el CRM.
 * Entra como lead NUEVO, igual que los que entran solos.
 */
export async function createContactAction(formData: FormData): Promise<CreateContactResult> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { ok: false, error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("contacts");

  const parsed = createContactSchema.safeParse({
    name: formData.get("name"),
    phoneNumber: formData.get("phoneNumber"),
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Datos invalidos" };
  }

  const phoneNumber = normalizeNewContactPhone(parsed.data.phoneNumber);
  if (!phoneNumber) {
    return { ok: false, error: "Ese numero no parece valido. Ej: 3001234567" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return { ok: false, error: "Workspace no encontrado" };
  }

  // Si ya existe se avisa en vez de fallar: lo mas probable es que la asesora no lo haya
  // encontrado buscando, y lo util es decirle que ya esta, no un error de base de datos.
  const existente = await prisma.contact.findUnique({
    where: { workspaceId_phoneNumber: { workspaceId: membership.workspace.id, phoneNumber } },
    select: { id: true, name: true },
  });

  if (existente) {
    return {
      ok: false,
      error: `Ese numero ya esta en la lista${existente.name?.trim() ? ` como "${existente.name.trim()}"` : ""}.`,
    };
  }

  const created = await prisma.contact.create({
    data: {
      workspaceId: membership.workspace.id,
      name: parsed.data.name,
      phoneNumber,
      email: parsed.data.email,
      metadata: { source: "carga manual" },
    },
    select: { id: true },
  });

  revalidatePath("/cliente/contactos");
  revalidatePath("/cliente/crm");

  return { ok: true, contactId: created.id };
}

/**
 * Abrir el chat de un contacto, aunque nunca haya escrito.
 *
 * Hasta ahora solo se podia responder a quien escribia primero: un numero cargado a mano —el que
 * te pasan por telefono, el del cliente que llamo— no tenia como recibir un mensaje desde la app,
 * y la asesora terminaba escribiendole desde su WhatsApp personal. Ahi el mensaje no queda
 * registrado, el lead no cambia de etapa y nadie mas se entera de que lo trabajaron.
 *
 * Si el contacto ya tiene conversacion se devuelve esa; si no, se crea vacia sobre el canal de
 * ventas conectado. Una conversacion sin mensajes se dibuja bien (dice "Sin mensajes visibles
 * aun") y se llena en cuanto se manda el primero.
 */
export async function abrirConversacionConContactoAction(
  contactId: string,
): Promise<{ conversationId?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("chats");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" };
  }
  const workspaceId = membership.workspace.id;

  const contacto = await prisma.contact.findFirst({
    where: { id: contactId.trim(), workspaceId },
    select: { id: true },
  });
  if (!contacto) {
    return { error: "Contacto no encontrado" };
  }

  // La mas reciente: si el contacto escribio alguna vez, se sigue esa conversacion en vez de
  // abrir una nueva al lado y partir el historial en dos.
  const existente = await prisma.conversation.findFirst({
    where: { workspaceId, contactId: contacto.id },
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    select: { id: true },
  });
  if (existente) {
    return { conversationId: existente.id };
  }

  /**
   * Por que canal sale. Se elige uno CONECTADO y de ventas: mandar por un numero apagado deja el
   * mensaje en la nada, y hacerlo por el administrativo le muestra al cliente un numero que no
   * reconoce.
   */
  const canalDeVentas = await prisma.whatsAppChannel.findFirst({
    where: { workspaceId, status: "CONNECTED", purpose: "SALES" },
    orderBy: { createdAt: "asc" },
    select: { id: true, agentId: true },
  });
  // Sin ninguno de ventas conectado se usa el que haya: es preferible que el mensaje salga por un
  // numero raro a que la asesora no pueda escribir.
  const canal =
    canalDeVentas ??
    (await prisma.whatsAppChannel.findFirst({
      where: { workspaceId, status: "CONNECTED" },
      orderBy: { createdAt: "asc" },
      select: { id: true, agentId: true },
    }));
  if (!canal) {
    return { error: "No hay ningún canal de WhatsApp conectado para enviar el mensaje." };
  }

  const creada = await prisma.conversation.create({
    data: {
      workspaceId,
      contactId: contacto.id,
      channelId: canal.id,
      agentId: canal.agentId,
      // Queda a nombre de quien la abre: la escribio ella, es suya.
      assignedToUserId: session.user.id,
      status: "OPEN",
    },
    select: { id: true },
  });

  revalidatePath("/cliente/chats");
  return { conversationId: creada.id };
}
