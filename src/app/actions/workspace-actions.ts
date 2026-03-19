"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateUniqueWorkspaceSlug } from "@/lib/workspace";

const workspaceOnboardingSchema = z.object({
  businessName: z.string().trim().min(2, "Nombre del negocio invalido").max(120, "Nombre demasiado largo"),
  businessType: z.string().trim().min(2, "Tipo de negocio invalido").max(80, "Tipo de negocio invalido"),
  country: z.string().trim().min(2, "Pais invalido").max(80, "Pais invalido"),
  city: z.string().trim().min(2, "Ciudad invalida").max(80, "Ciudad invalida"),
});

export async function completeWorkspaceOnboardingAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const parsed = workspaceOnboardingSchema.safeParse({
    businessName: formData.get("businessName"),
    businessType: formData.get("businessType"),
    country: formData.get("country"),
    city: formData.get("city"),
  });

  if (!parsed.success) {
    redirect("/cliente/onboarding?error=Datos+del+negocio+invalidos");
  }

  const existingMembership = await prisma.workspaceMember.findFirst({
    where: { userId: session.user.id },
    select: { id: true },
  });

  if (existingMembership) {
    redirect("/cliente");
  }

  const slug = await generateUniqueWorkspaceSlug(parsed.data.businessName);
  const workspace = await prisma.workspace.create({
    data: {
      name: parsed.data.businessName,
      slug,
      ownerId: session.user.id,
      memberships: {
        create: {
          userId: session.user.id,
          role: "OWNER",
        },
      },
    },
    select: { id: true },
  });

  await prisma.appSetting.createMany({
    data: [
      {
        key: `workspace:${workspace.id}:businessType`,
        value: parsed.data.businessType,
      },
      {
        key: `workspace:${workspace.id}:country`,
        value: parsed.data.country,
      },
      {
        key: `workspace:${workspace.id}:city`,
        value: parsed.data.city,
      },
    ],
    skipDuplicates: true,
  });

  revalidatePath("/cliente");
  revalidatePath("/cliente/onboarding");
  redirect("/cliente?ok=Negocio+configurado");
}
