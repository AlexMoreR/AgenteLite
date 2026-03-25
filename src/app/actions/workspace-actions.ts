"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { buildDefaultWorkspacePlan } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { generateUniqueWorkspaceSlug } from "@/lib/workspace";

const workspaceOnboardingSchema = z.object({
  businessName: z.string().trim().min(2, "Nombre del negocio invalido").max(120, "Nombre demasiado largo"),
  businessType: z.string().trim().min(2, "Tipo de negocio invalido").max(80, "Tipo de negocio invalido"),
  country: z.string().trim().min(2, "Pais invalido").max(80, "Pais invalido"),
  city: z.string().trim().min(2, "Ciudad invalida").max(80, "Ciudad invalida"),
  returnTo: z.string().trim().optional(),
});

const resetWorkspaceSchema = z.object({
  confirm: z.literal("RESET"),
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
    returnTo: formData.get("returnTo"),
  });

  if (!parsed.success) {
    redirect("/cliente/onboarding?error=Datos+del+negocio+invalidos");
  }

  const existingMembership = await prisma.workspaceMember.findFirst({
    where: { userId: session.user.id },
    select: { id: true },
  });

  if (existingMembership) {
    redirect(parsed.data.returnTo && parsed.data.returnTo.startsWith("/") ? parsed.data.returnTo : "/cliente");
  }

  const slug = await generateUniqueWorkspaceSlug(parsed.data.businessName);
  const defaultPlan = buildDefaultWorkspacePlan();
  const workspace = await prisma.workspace.create({
    data: {
      name: parsed.data.businessName,
      slug,
      ownerId: session.user.id,
      ...defaultPlan,
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
  if (parsed.data.returnTo && parsed.data.returnTo.startsWith("/")) {
    redirect(`${parsed.data.returnTo}?ok=Negocio+configurado`);
  }

  redirect("/cliente?ok=Negocio+configurado");
}

export async function resetWorkspaceAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const parsed = resetWorkspaceSchema.safeParse({
    confirm: formData.get("confirm"),
  });

  if (!parsed.success) {
    redirect("/cliente/agentes?error=Confirmacion+invalida");
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: {
      workspace: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!membership?.workspace.id) {
    redirect("/cliente/agentes?error=No+hay+negocio+configurado");
  }

  await prisma.appSetting.deleteMany({
    where: {
      key: {
        startsWith: `workspace:${membership.workspace.id}:`,
      },
    },
  });

  await prisma.workspace.delete({
    where: {
      id: membership.workspace.id,
    },
  });

  revalidatePath("/cliente");
  revalidatePath("/cliente/agentes");
  redirect("/cliente/agentes?ok=Negocio+reiniciado.+Ahora+puedes+crear+todo+desde+cero");
}
