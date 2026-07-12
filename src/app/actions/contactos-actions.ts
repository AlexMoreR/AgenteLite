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
