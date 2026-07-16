"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { isSupportedCurrency, type SupportedCurrencyCode } from "@/lib/currency";
import {
  getEvolutionGateways,
  setEvolutionGateways,
  setEvolutionSettings,
  setSystemBrandName,
  setSystemCurrency,
  setSystemPrimaryColor,
} from "@/lib/system-settings";

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

const updateEvolutionSettingsSchema = z.object({
  apiBaseUrl: z.string().trim().url("URL invalida"),
  apiToken: z.string().trim().min(8, "Token invalido"),
  instancePrefix: z
    .string()
    .trim()
    .min(3, "Prefijo invalido")
    .max(30, "Prefijo demasiado largo")
    .regex(/^[a-z0-9-]+$/, "Solo minusculas, numeros y guiones"),
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

const createEvolutionGatewaySchema = z.object({
  kind: z.enum(["EVOLUTION_GO", "EVOLUTION_API"]),
  baseUrl: z.string().trim().url("URL invalida"),
  apiKey: z.string().trim().optional(),
});

const deleteEvolutionGatewaySchema = z.object({
  id: z.string().trim().min(1, "Conexion invalida"),
});

/** Agrega una conexion (Evolution GO o API) al catalogo que eligen los canales. */
export async function adminCreateEvolutionGatewayAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const parsed = createEvolutionGatewaySchema.safeParse({
    kind: formData.get("kind"),
    baseUrl: formData.get("baseUrl"),
    apiKey: formData.get("apiKey"),
  });

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || "Conexion invalida";
    redirect(`/admin/configuracion/whatsapp?error=${encodeURIComponent(message)}`);
  }

  const current = await getEvolutionGateways();
  await setEvolutionGateways([
    ...current,
    {
      id: randomUUID(),
      kind: parsed.data.kind,
      baseUrl: parsed.data.baseUrl,
      apiKey: parsed.data.apiKey ?? "",
    },
  ]);

  revalidatePath("/admin/configuracion/whatsapp");
  revalidatePath("/cliente/conexion");
  redirect("/admin/configuracion/whatsapp?ok=Conexion+agregada");
}

/** Elimina una conexion del catalogo. Los canales ya creados conservan su copia. */
export async function adminDeleteEvolutionGatewayAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const parsed = deleteEvolutionGatewaySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) {
    redirect("/admin/configuracion/whatsapp?error=Conexion+invalida");
  }

  const current = await getEvolutionGateways();
  await setEvolutionGateways(current.filter((gateway) => gateway.id !== parsed.data.id));

  revalidatePath("/admin/configuracion/whatsapp");
  revalidatePath("/cliente/conexion");
  redirect("/admin/configuracion/whatsapp?ok=Conexion+eliminada");
}

export async function adminUpdateEvolutionSettingsAction(formData: FormData): Promise<void> {
  await requireAdminSession();

  const parsed = updateEvolutionSettingsSchema.safeParse({
    apiBaseUrl: formData.get("apiBaseUrl"),
    apiToken: formData.get("apiToken"),
    instancePrefix: formData.get("instancePrefix"),
  });

  if (!parsed.success) {
    redirect("/admin/configuracion/whatsapp?error=Configuracion+de+Evolution+invalida");
  }

  await setEvolutionSettings({
    apiBaseUrl: parsed.data.apiBaseUrl,
    apiToken: parsed.data.apiToken,
    instancePrefix: parsed.data.instancePrefix,
    webhookBaseUrl: "",
    webhookSecret: "",
  });

  revalidatePath("/admin");
  revalidatePath("/admin/configuracion");
  revalidatePath("/admin/configuracion/whatsapp");
  redirect("/admin/configuracion/whatsapp?ok=Configuracion+de+WhatsApp+actualizada");
}
