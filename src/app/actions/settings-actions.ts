"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { isSupportedCurrency, type SupportedCurrencyCode } from "@/lib/currency";
import { setSystemBrandName, setSystemCurrency, setSystemPrimaryColor } from "@/lib/system-settings";

const updateCurrencySchema = z.object({
  currency: z
    .string()
    .trim()
    .refine(isSupportedCurrency, "Moneda invalida")
    .transform((value) => value as SupportedCurrencyCode),
});

const updatePrimaryColorSchema = z.object({
  primaryColor: z
    .string()
    .trim()
    .regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/, "Color invalido"),
});

const updateBrandNameSchema = z.object({
  brandName: z.string().trim().min(2, "Nombre invalido").max(80, "Nombre demasiado largo"),
});

async function requireAdminSession(): Promise<void> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/unauthorized");
  }
}

export async function adminUpdateCurrencyAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const parsed = updateCurrencySchema.safeParse({
    currency: formData.get("currency"),
  });

  if (!parsed.success) {
    redirect("/admin/configuracion/negocio?error=Moneda+invalida");
  }

  await setSystemCurrency(parsed.data.currency);

  revalidatePath("/");
  revalidatePath("/admin/configuracion");
  revalidatePath("/admin/configuracion/negocio");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/productos/new");
  redirect("/admin/configuracion/negocio?ok=Moneda+actualizada");
}

export async function adminUpdatePrimaryColorAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const parsed = updatePrimaryColorSchema.safeParse({
    primaryColor: formData.get("primaryColor"),
  });

  if (!parsed.success) {
    redirect("/admin/configuracion/negocio?error=Color+invalido");
  }

  await setSystemPrimaryColor(parsed.data.primaryColor);

  revalidatePath("/");
  revalidatePath("/login");
  revalidatePath("/register");
  revalidatePath("/admin");
  revalidatePath("/admin/configuracion");
  revalidatePath("/admin/configuracion/negocio");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/productos/new");
  redirect("/admin/configuracion/negocio?ok=Color+actualizado");
}

export async function adminUpdateBrandNameAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const parsed = updateBrandNameSchema.safeParse({
    brandName: formData.get("brandName"),
  });

  if (!parsed.success) {
    redirect("/admin/configuracion/negocio?error=Nombre+de+marca+invalido");
  }

  await setSystemBrandName(parsed.data.brandName);

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/configuracion");
  revalidatePath("/admin/configuracion/negocio");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/proveedores");
  revalidatePath("/admin/categorias");
  redirect("/admin/configuracion/negocio?ok=Marca+actualizada");
}
