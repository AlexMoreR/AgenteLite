"use server";

import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createPasswordResetToken } from "@/lib/email-verification";
import { sendEmployeeInviteEmail } from "@/lib/mailer";
import { getPublicBaseUrl } from "@/lib/app-url";
import { prisma } from "@/lib/prisma";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { sanitizeClientModuleAccess } from "@/lib/client-workspace-modules";

const teamBasePath = "/cliente/equipo";

const employeeIdentitySchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
});

const memberIdSchema = z.object({
  memberId: z.string().min(1),
});

function redirectWithMessage(kind: "ok" | "error", message: string): never {
  redirect(`${teamBasePath}?${kind}=${encodeURIComponent(message)}`);
}

function getSelectedModules(formData: FormData) {
  return sanitizeClientModuleAccess(formData.getAll("modules"));
}

async function sendInvite(input: {
  userId: string;
  email: string;
  name: string | null;
  workspaceName: string;
}) {
  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) {
    throw new Error("Falta configurar AUTH_URL, NEXTAUTH_URL o NEXT_PUBLIC_SITE_URL");
  }

  const token = await createPasswordResetToken(input.userId, input.email);
  const inviteUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

  await sendEmployeeInviteEmail({
    to: input.email,
    name: input.name ?? "",
    workspaceName: input.workspaceName,
    inviteUrl,
  });
}

async function requireTeamOwner() {
  return requireClientWorkspaceAccess("client_team", { ownerOnly: true });
}

export async function clientInviteEmployeeAction(formData: FormData): Promise<void> {
  const access = await requireTeamOwner();
  const parsed = employeeIdentitySchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
  });

  if (!parsed.success) {
    redirectWithMessage("error", "Datos del empleado invalidos");
  }

  const modules = getSelectedModules(formData);
  const { name, email } = parsed.data;
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      role: true,
      workspaceMemberships: {
        select: {
          id: true,
          workspaceId: true,
          isActive: true,
        },
      },
    },
  });

  if (existingUser) {
    if (existingUser.role !== "EMPLEADO") {
      redirectWithMessage("error", "Ese correo ya pertenece a otro tipo de usuario");
    }

    const sameWorkspaceMembership = existingUser.workspaceMemberships.find(
      (membership) => membership.workspaceId === access.workspaceId,
    );

    if (!sameWorkspaceMembership) {
      redirectWithMessage("error", "Ese empleado ya pertenece a otro negocio");
    }

    if (sameWorkspaceMembership.isActive) {
      redirectWithMessage("error", "Ese empleado ya esta activo en tu equipo");
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: existingUser.id },
        data: { name, role: "EMPLEADO" },
      }),
      prisma.workspaceMember.update({
        where: { id: sameWorkspaceMembership.id },
        data: {
          role: "AGENT",
          moduleAccess: modules,
          isActive: true,
          deactivatedAt: null,
          invitedAt: new Date(),
        },
      }),
    ]);

    try {
      await sendInvite({
        userId: existingUser.id,
        email,
        name,
        workspaceName: access.workspaceName,
      });
    } catch (error) {
      console.error("No se pudo reenviar la invitacion al empleado:", error);
      revalidatePath(teamBasePath);
      redirectWithMessage("error", "Empleado reactivado, pero no se pudo enviar el correo");
    }

    revalidatePath(teamBasePath);
    redirectWithMessage("ok", "Empleado reactivado e invitacion enviada");
  }

  const hashedPassword = await bcrypt.hash(randomUUID().replace(/-/g, ""), 12);
  const created = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role: "EMPLEADO",
      workspaceMemberships: {
        create: {
          workspaceId: access.workspaceId,
          role: "AGENT",
          moduleAccess: modules,
          isActive: true,
          invitedAt: new Date(),
        },
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
    },
  });

  try {
    await sendInvite({
      userId: created.id,
      email: created.email,
      name: created.name,
      workspaceName: access.workspaceName,
    });
  } catch (error) {
    console.error("No se pudo enviar la invitacion al empleado:", error);
    revalidatePath(teamBasePath);
    redirectWithMessage("error", "Empleado creado, pero no se pudo enviar el correo");
  }

  revalidatePath(teamBasePath);
  redirectWithMessage("ok", "Empleado invitado");
}

export async function clientUpdateEmployeeModulesAction(formData: FormData): Promise<void> {
  const access = await requireTeamOwner();
  const parsed = memberIdSchema.safeParse({
    memberId: formData.get("memberId"),
  });

  if (!parsed.success) {
    redirectWithMessage("error", "Empleado invalido");
  }

  const modules = getSelectedModules(formData);
  const result = await prisma.workspaceMember.updateMany({
    where: {
      id: parsed.data.memberId,
      workspaceId: access.workspaceId,
      role: "AGENT",
      user: { role: "EMPLEADO" },
    },
    data: {
      moduleAccess: modules,
    },
  });

  if (result.count === 0) {
    redirectWithMessage("error", "Empleado no encontrado");
  }

  revalidatePath(teamBasePath);
  redirectWithMessage("ok", "Permisos actualizados");
}

export async function clientDeactivateEmployeeAction(formData: FormData): Promise<void> {
  const access = await requireTeamOwner();
  const parsed = memberIdSchema.safeParse({
    memberId: formData.get("memberId"),
  });

  if (!parsed.success) {
    redirectWithMessage("error", "Empleado invalido");
  }

  const result = await prisma.workspaceMember.updateMany({
    where: {
      id: parsed.data.memberId,
      workspaceId: access.workspaceId,
      role: "AGENT",
      user: { role: "EMPLEADO" },
    },
    data: {
      isActive: false,
      deactivatedAt: new Date(),
    },
  });

  if (result.count === 0) {
    redirectWithMessage("error", "Empleado no encontrado");
  }

  revalidatePath(teamBasePath);
  redirectWithMessage("ok", "Empleado desactivado");
}

export async function clientReactivateEmployeeAction(formData: FormData): Promise<void> {
  const access = await requireTeamOwner();
  const parsed = memberIdSchema.safeParse({
    memberId: formData.get("memberId"),
  });

  if (!parsed.success) {
    redirectWithMessage("error", "Empleado invalido");
  }

  const result = await prisma.workspaceMember.updateMany({
    where: {
      id: parsed.data.memberId,
      workspaceId: access.workspaceId,
      role: "AGENT",
      user: { role: "EMPLEADO" },
    },
    data: {
      isActive: true,
      deactivatedAt: null,
    },
  });

  if (result.count === 0) {
    redirectWithMessage("error", "Empleado no encontrado");
  }

  revalidatePath(teamBasePath);
  redirectWithMessage("ok", "Empleado reactivado");
}

export async function clientResendEmployeeInviteAction(formData: FormData): Promise<void> {
  const access = await requireTeamOwner();
  const parsed = memberIdSchema.safeParse({
    memberId: formData.get("memberId"),
  });

  if (!parsed.success) {
    redirectWithMessage("error", "Empleado invalido");
  }

  const member = await prisma.workspaceMember.findFirst({
    where: {
      id: parsed.data.memberId,
      workspaceId: access.workspaceId,
      role: "AGENT",
      isActive: true,
      user: { role: "EMPLEADO" },
    },
    select: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  if (!member) {
    redirectWithMessage("error", "Empleado no encontrado");
  }

  try {
    await sendInvite({
      userId: member.user.id,
      email: member.user.email,
      name: member.user.name,
      workspaceName: access.workspaceName,
    });
  } catch (error) {
    console.error("No se pudo reenviar la invitacion al empleado:", error);
    redirectWithMessage("error", "No se pudo enviar el correo");
  }

  revalidatePath(teamBasePath);
  redirectWithMessage("ok", "Invitacion reenviada");
}
