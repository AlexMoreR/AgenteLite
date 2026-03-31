"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { z } from "zod";
import { auth, signIn, signOut } from "@/auth";
import {
  adminModuleDefinitions,
  type AdminModuleKey,
  getStoredRoleModuleAccessMap,
  setStoredRoleModuleAccessMap,
} from "@/lib/admin-module-access";
import { getPublicBaseUrl } from "@/lib/app-url";
import {
  consumePasswordResetToken,
  createEmailVerificationToken,
  createPasswordResetToken,
} from "@/lib/email-verification";
import {
  sendAccountCreatedEmail,
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
} from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import {
  ActionState,
  changePasswordSchema,
  loginSchema,
  profileSchema,
  registerSchema,
  resetPasswordSchema,
} from "@/lib/validations/auth";

const roleRedirect: Record<Role, string> = {
  ADMIN: "/admin",
  EMPLEADO: "/empleado",
  CLIENTE: "/cliente",
};

const defaultState: ActionState = { ok: false, message: "" };

async function requireAdminSession(): Promise<void> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/unauthorized");
  }
}

export async function loginAction(
  prevState: ActionState = defaultState,
  formData: FormData,
): Promise<ActionState> {
  void prevState;
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Datos invalidos",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return { ok: false, message: "Credenciales invalidas" };
  }

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) {
    return { ok: false, message: "Credenciales invalidas" };
  }

  if (user.role === "CLIENTE" && !user.emailVerified) {
    return { ok: false, message: "Debes confirmar tu correo antes de iniciar sesion" };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: roleRedirect[user.role],
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, message: "No se pudo iniciar sesion" };
    }
    throw error;
  }

  return { ok: true, message: "Sesion iniciada" };
}

export async function registerAction(
  prevState: ActionState = defaultState,
  formData: FormData,
): Promise<ActionState> {
  void prevState;
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: "CLIENTE",
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Datos invalidos",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { ok: false, message: "El correo ya existe" };
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const createdUser = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role: "CLIENTE",
    },
    select: { id: true },
  });

  try {
    const baseUrl = getPublicBaseUrl();
    if (!baseUrl) {
      await prisma.user.delete({ where: { id: createdUser.id } }).catch(() => null);
      return {
        ok: false,
        message: "Falta configurar AUTH_URL, NEXTAUTH_URL o NEXT_PUBLIC_SITE_URL para enviar el enlace de verificacion",
      };
    }
    const token = await createEmailVerificationToken(createdUser.id, email);
    const verificationUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;

    await sendEmailVerificationEmail({
      to: email,
      name,
      verificationUrl,
    });
  } catch (error) {
    await prisma.user.delete({ where: { id: createdUser.id } }).catch(() => null);
    console.error("No se pudo enviar el correo de verificacion:", error);
    return { ok: false, message: "No se pudo enviar el correo de verificacion" };
  }

  return { ok: true, message: "Registro creado. Revisa tu correo y confirma tu cuenta para poder iniciar sesion" };
}

export async function updateProfileAction(
  prevState: ActionState = defaultState,
  formData: FormData,
): Promise<ActionState> {
  void prevState;
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "No autorizado" };
  }

  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    image: formData.get("image"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Datos invalidos",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const emailInUse = await prisma.user.findFirst({
    where: {
      email: parsed.data.email,
      NOT: { id: session.user.id },
    },
    select: { id: true },
  });

  if (emailInUse) {
    return { ok: false, message: "El correo ya existe" };
  }

  const updatedUser = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      image: parsed.data.image || null,
    },
    select: {
      name: true,
      email: true,
      image: true,
    },
  });

  revalidatePath("/profile");

  return {
    ok: true,
    message: "Perfil actualizado",
    data: {
      name: updatedUser.name ?? "",
      email: updatedUser.email,
      image: updatedUser.image,
    },
  };
}

export async function changePasswordAction(
  prevState: ActionState = defaultState,
  formData: FormData,
): Promise<ActionState> {
  void prevState;
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "No autorizado" };
  }

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Datos invalidos",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const { currentPassword, newPassword } = parsed.data;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { password: true },
  });

  if (!user) {
    return { ok: false, message: "Usuario no encontrado" };
  }

  const isCurrentValid = await bcrypt.compare(currentPassword, user.password);
  if (!isCurrentValid) {
    return { ok: false, message: "La contrasena actual es incorrecta" };
  }

  const isSamePassword = await bcrypt.compare(newPassword, user.password);
  if (isSamePassword) {
    return { ok: false, message: "La nueva contrasena debe ser diferente" };
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { id: session.user.id },
    data: { password: hashedPassword },
  });

  return { ok: true, message: "Contrasena actualizada" };
}

export async function requestPasswordResetAction(
  prevState: ActionState = defaultState,
): Promise<ActionState> {
  void prevState;

  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return { ok: false, message: "No autorizado" };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    return { ok: false, message: "Usuario no encontrado" };
  }

  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) {
    return {
      ok: false,
      message: "Falta configurar AUTH_URL, NEXTAUTH_URL o NEXT_PUBLIC_SITE_URL para enviar el enlace",
    };
  }

  try {
    const token = await createPasswordResetToken(user.id, user.email);
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

    await sendPasswordResetEmail({
      to: user.email,
      name: user.name ?? "",
      resetUrl,
    });

    return { ok: true, message: "Te enviamos un enlace de recuperacion a tu correo" };
  } catch (error) {
    console.error("No se pudo enviar el correo de recuperacion:", error);
    return { ok: false, message: "No se pudo enviar el correo de recuperacion" };
  }
}

export async function resetPasswordWithTokenAction(
  prevState: ActionState = defaultState,
  formData: FormData,
): Promise<ActionState> {
  void prevState;

  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Datos invalidos",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const { token, newPassword } = parsed.data;
  const payload = await consumePasswordResetToken(token);
  if (!payload) {
    return { ok: false, message: "El enlace de recuperacion es invalido o expiro" };
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { password: true, email: true },
  });

  if (!user || user.email !== payload.email) {
    return { ok: false, message: "No se pudo validar la cuenta" };
  }

  const isSamePassword = await bcrypt.compare(newPassword, user.password);
  if (isSamePassword) {
    return { ok: false, message: "La nueva contrasena debe ser diferente" };
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { id: payload.userId },
    data: { password: hashedPassword },
  });

  return { ok: true, message: "Contrasena actualizada. Ya puedes iniciar sesion" };
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

export async function adminCreateUserAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    redirect("/admin/configuracion/usuarios?error=Datos+invalidos");
  }

  const { name, email, password, role } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    redirect("/admin/configuracion/usuarios?error=El+correo+ya+existe");
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role,
    },
  });

  try {
    await sendAccountCreatedEmail({ to: email, name, role });
  } catch (error) {
    console.error("No se pudo enviar el correo de bienvenida:", error);
  }

  revalidatePath("/admin/configuracion");
  revalidatePath("/admin/configuracion/usuarios");
  revalidatePath("/admin/configuracion/permisos");
  redirect("/admin/configuracion/usuarios?ok=Usuario+creado");
}

const updateRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.nativeEnum(Role),
});

const updateWorkspacePlanExpirySchema = z.object({
  workspaceId: z.string().min(1),
  planExpiresAt: z.string().trim().optional(),
});

const deleteUserSchema = z.object({
  userId: z.string().min(1),
});

const adminSendPasswordResetSchema = z.object({
  userId: z.string().min(1),
});

export async function adminUpdateUserRoleAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const parsed = updateRoleSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    redirect("/admin/configuracion/usuarios?error=Datos+invalidos");
  }

  const { userId, role } = parsed.data;
  const targetUser = await prisma.user.findUnique({ where: { id: userId } });

  if (!targetUser) {
    redirect("/admin/configuracion/usuarios?error=Usuario+no+encontrado");
  }

  if (targetUser.role === "ADMIN" && role !== "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) {
      redirect("/admin/configuracion/usuarios?error=Debe+existir+al+menos+un+admin");
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { role },
  });

  revalidatePath("/admin/configuracion");
  revalidatePath("/admin/configuracion/usuarios");
  revalidatePath("/admin/configuracion/permisos");
  redirect("/admin/configuracion/usuarios?ok=Rol+actualizado");
}

export async function adminSendPasswordResetAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const parsed = adminSendPasswordResetSchema.safeParse({
    userId: formData.get("userId"),
  });

  if (!parsed.success) {
    redirect("/admin/configuracion/usuarios?error=Usuario+invalido");
  }

  const user = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
    },
  });

  if (!user) {
    redirect("/admin/configuracion/usuarios?error=Usuario+no+encontrado");
  }

  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) {
    redirect(
      "/admin/configuracion/usuarios?error=Falta+configurar+AUTH_URL,+NEXTAUTH_URL+o+NEXT_PUBLIC_SITE_URL",
    );
  }

  try {
    const token = await createPasswordResetToken(user.id, user.email);
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

    await sendPasswordResetEmail({
      to: user.email,
      name: user.name ?? "",
      resetUrl,
    });
  } catch (error) {
    console.error("No se pudo enviar el correo de recuperacion desde admin:", error);
    redirect("/admin/configuracion/usuarios?error=No+se+pudo+enviar+el+correo+de+recuperacion");
  }

  redirect("/admin/configuracion/usuarios?ok=Correo+de+recuperacion+enviado");
}

export async function adminUpdateWorkspacePlanExpiryAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const parsed = updateWorkspacePlanExpirySchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    planExpiresAt: formData.get("planExpiresAt"),
  });

  if (!parsed.success) {
    redirect("/admin/configuracion/usuarios?error=Fecha+de+vencimiento+invalida");
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: parsed.data.workspaceId },
    select: {
      id: true,
      planTier: true,
    },
  });

  if (!workspace) {
    redirect("/admin/configuracion/usuarios?error=Negocio+no+encontrado");
  }

  const rawDate = parsed.data.planExpiresAt?.trim() ?? "";
  const nextDate = rawDate ? new Date(`${rawDate}T23:59:59.999Z`) : null;

  if (rawDate && Number.isNaN(nextDate?.getTime())) {
    redirect("/admin/configuracion/usuarios?error=Fecha+de+vencimiento+invalida");
  }

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: {
      planExpiresAt: nextDate,
    },
  });

  revalidatePath("/admin/configuracion");
  revalidatePath("/admin/configuracion/usuarios");
  redirect("/admin/configuracion/usuarios?ok=Vencimiento+actualizado");
}

export async function adminDeleteUserAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/admin/configuracion/usuarios?error=No+autorizado");
  }

  const parsed = deleteUserSchema.safeParse({
    userId: formData.get("userId"),
  });

  if (!parsed.success) {
    redirect("/admin/configuracion/usuarios?error=Usuario+invalido");
  }

  const userId = parsed.data.userId;

  if (userId === session.user.id) {
    redirect("/admin/configuracion/usuarios?error=No+puedes+eliminar+tu+propia+cuenta");
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      _count: {
        select: {
          quotesAsClient: true,
          quotesCreated: true,
          workspaceMemberships: true,
          ownedWorkspaces: true,
        },
      },
    },
  });

  if (!targetUser) {
    redirect("/admin/configuracion/usuarios?error=Usuario+no+encontrado");
  }

  if (targetUser.role === "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) {
      redirect("/admin/configuracion/usuarios?error=Debe+existir+al+menos+un+admin");
    }
  }

  if (targetUser._count.quotesAsClient > 0 || targetUser._count.quotesCreated > 0) {
    redirect("/admin/configuracion/usuarios?error=No+puedes+eliminar+un+usuario+con+cotizaciones+asociadas");
  }

  await prisma.user.delete({
    where: { id: userId },
  });

  revalidatePath("/admin/configuracion");
  revalidatePath("/admin/configuracion/usuarios");
  revalidatePath("/admin/configuracion/permisos");
  redirect("/admin/configuracion/usuarios?ok=Usuario+eliminado");
}

export async function adminUpdateUserModuleAccessAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    redirect("/admin/configuracion/permisos?error=No+autorizado");
  }

  const role = String(formData.get("role") ?? "").trim() as Role;
  if (!["ADMIN", "EMPLEADO", "CLIENTE"].includes(role)) {
    redirect("/admin/configuracion/permisos?error=Rol+invalido");
  }

  const validKeys = new Set<AdminModuleKey>(adminModuleDefinitions.map((item) => item.key));
  const selectedModules = formData
    .getAll("modules")
    .map((item) => String(item))
    .filter((item): item is AdminModuleKey => validKeys.has(item as AdminModuleKey));

  const normalizedModules = new Set<AdminModuleKey>(selectedModules);

  if (role === "ADMIN") {
    normalizedModules.add("config_permissions");
  }

  const currentMap = await getStoredRoleModuleAccessMap();
  currentMap[role] = Array.from(normalizedModules);
  await setStoredRoleModuleAccessMap(currentMap);

  revalidatePath("/admin");
  revalidatePath("/admin/configuracion");
  revalidatePath("/admin/configuracion/permisos");
  revalidatePath("/admin/configuracion/usuarios");
  revalidatePath("/admin/configuracion/negocio");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/categorias");
  revalidatePath("/admin/proveedores");
  revalidatePath("/admin/cotizaciones");
  redirect("/admin/configuracion/permisos?ok=Permisos+actualizados");
}
