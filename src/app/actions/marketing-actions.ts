"use server";

import { randomUUID } from "node:crypto";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import {
  generateFacebookAdCreativesForProduct,
  type FacebookAdCreative,
} from "@/lib/facebook-ad-creatives";
import {
  clearWorkspaceMarketingLogoUrl,
  getWorkspaceMarketingLogoUrl,
  setWorkspaceMarketingLogoUrl,
} from "@/lib/marketing-branding";
import { getMarketingContextSettingKey } from "@/lib/marketing-business-context";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export type FacebookAdsGeneratorState = {
  ok: boolean;
  message: string;
  creatives: FacebookAdCreative[];
  sourceImageUrl?: string;
  creativeMode?: "real" | "creative" | "inspired";
};

const generateFacebookAdsSchema = z.object({
  creativeMode: z.enum(["real", "creative", "inspired"]).default("real"),
  productName: z.string().trim().min(2, "Escribe el nombre del producto").max(120),
  productDescription: z
    .string()
    .trim()
    .max(400, "La descripcion es demasiado larga")
    .optional(),
  brief: z
    .string()
    .trim()
    .max(240, "Las instrucciones extra son demasiado largas")
    .optional(),
  includeBusinessLogo: z.union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")]).optional(),
});

const deleteCreativeImagesSchema = z.object({
  imageUrls: z.array(z.string().trim().min(1)).min(1).max(24),
  sourceImageUrl: z.string().trim().min(1).optional(),
});

const marketingContextSchema = z.object({
  valueProposition: z.string().trim().min(12, "Cuentanos que hace especial a tu negocio").max(240),
  idealCustomer: z.string().trim().min(12, "Describe mejor a que tipo de cliente le vendes").max(240),
  painPoints: z.string().trim().min(12, "Cuentanos que problema le resuelves a tu cliente").max(320),
  mainOffer: z.string().trim().min(6, "Cuentanos que vendes o que quieres impulsar primero").max(180),
  primaryCallToAction: z.string().trim().min(3, "Dinos cual es la accion principal que quieres lograr").max(80),
  websiteUrl: z.string().trim().url("La pagina web no es valida").or(z.literal("")),
  instagramUrl: z.string().trim().url("Instagram no es valido").or(z.literal("")),
  facebookUrl: z.string().trim().url("Facebook no es valido").or(z.literal("")),
  tiktokUrl: z.string().trim().url("TikTok no es valido").or(z.literal("")),
});

async function requireMarketingWorkspace() {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    throw new Error("No autorizado");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    throw new Error("No workspace");
  }

  return membership;
}

async function saveMarketingSourceImage(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Solo se permiten archivos de imagen");
  }

  if (file.size <= 0) {
    throw new Error("La imagen esta vacia");
  }

  if (file.size > 8 * 1024 * 1024) {
    throw new Error("La imagen no puede pesar mas de 8MB");
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", "marketing-source");
  await mkdir(uploadDir, { recursive: true });

  const ext = path.extname(file.name)?.toLowerCase() || ".png";
  const safeExt = ext.length <= 8 ? ext : ".png";
  const fileName = `${Date.now()}-${randomUUID()}${safeExt}`;
  const filePath = path.join(uploadDir, fileName);
  const bytes = Buffer.from(await file.arrayBuffer());

  await writeFile(filePath, bytes);
  return `/uploads/marketing-source/${fileName}`;
}

async function saveMarketingBusinessLogo(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Logo invalido");
  }

  if (file.size <= 0) {
    throw new Error("Logo invalido");
  }

  if (file.size > 2 * 1024 * 1024) {
    throw new Error("Logo invalido");
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", "marketing-logos");
  await mkdir(uploadDir, { recursive: true });

  const ext = path.extname(file.name)?.toLowerCase() || ".png";
  const safeExt = ext.length <= 8 ? ext : ".png";
  const fileName = `${Date.now()}-${randomUUID()}${safeExt}`;
  const filePath = path.join(uploadDir, fileName);
  const bytes = Buffer.from(await file.arrayBuffer());

  await writeFile(filePath, bytes);
  return `/uploads/marketing-logos/${fileName}`;
}

async function deleteMarketingBusinessLogoFile(logoUrl: string | null | undefined): Promise<void> {
  if (!logoUrl || !logoUrl.startsWith("/uploads/marketing-logos/")) {
    return;
  }

  const normalizedPath = path.normalize(logoUrl).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(process.cwd(), "public", normalizedPath);

  try {
    await unlink(filePath);
  } catch {
    // Ignore missing files; persistence cleanup is the primary concern.
  }
}

async function deleteMarketingSourceImageFile(sourceImageUrl: string | null | undefined): Promise<void> {
  if (!sourceImageUrl || !sourceImageUrl.startsWith("/uploads/marketing-source/")) {
    return;
  }

  const normalizedPath = path.normalize(sourceImageUrl).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(process.cwd(), "public", normalizedPath);

  try {
    await unlink(filePath);
  } catch {
    // Ignore missing files; persistence cleanup is the primary concern.
  }
}

function isNextRedirectError(error: unknown) {
  return (
    error instanceof Error &&
    typeof (error as Error & { digest?: unknown }).digest === "string" &&
    (error as Error & { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

function resolveMarketingError(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("No autorizado")) {
    return "No tienes permisos para usar este modulo.";
  }

  if (
    message.includes("Solo se permiten archivos") ||
    message.includes("La imagen esta vacia") ||
    message.includes("8MB")
  ) {
    return message;
  }

  if (message.includes("OpenAI image 400")) {
    return "No se pudo generar una de las imagenes. Prueba con otra foto o con instrucciones mas simples.";
  }

  if (message.includes("OpenAI image 401")) {
    return "La integracion con OpenAI no esta autorizada.";
  }

  if (message.includes("OpenAI image 429")) {
    return "OpenAI esta recibiendo demasiadas solicitudes. Intenta de nuevo en un momento.";
  }

  if (message.includes("Logo invalido")) {
    return "El logo debe ser una imagen valida de maximo 2MB.";
  }

  if (message.includes("No workspace")) {
    return "Debes configurar tu negocio antes de usar Marketing IA.";
  }

  return "No se pudieron generar tus anuncios en este momento.";
}

function resolveCreativeDirectoryFromUrl(imageUrl: string) {
  const normalized = imageUrl.trim();
  const match = normalized.match(/^\/uploads\/ad-creatives\/([^/]+)\/[^/]+$/);
  if (!match) {
    return null;
  }

  const productId = match[1];
  if (!/^[a-zA-Z0-9_-]+$/.test(productId)) {
    return null;
  }

  const publicRoot = path.join(process.cwd(), "public");
  const directory = path.resolve(publicRoot, "uploads", "ad-creatives", productId);

  if (!directory.startsWith(path.join(publicRoot, "uploads", "ad-creatives"))) {
    return null;
  }

  return directory;
}

export async function generateFacebookAdsFromImageAction(
  previousState: FacebookAdsGeneratorState,
  formData: FormData,
): Promise<FacebookAdsGeneratorState> {
  try {
    const membership = await requireMarketingWorkspace();

    const parsed = generateFacebookAdsSchema.safeParse({
      creativeMode: formData.get("creativeMode") || "real",
      productName: formData.get("productName"),
      productDescription: formData.get("productDescription") || undefined,
      brief: formData.get("brief") || undefined,
      includeBusinessLogo: formData.get("includeBusinessLogo") || undefined,
    });

    if (!parsed.success) {
      return {
        ...previousState,
        ok: false,
        message: parsed.error.issues[0]?.message || "Datos invalidos",
      };
    }

    const image = formData.get("image");
    if (!(image instanceof File)) {
      return {
        ...previousState,
        ok: false,
        message: "Debes subir la foto del producto.",
      };
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return {
        ...previousState,
        ok: false,
        message: "Falta configurar OPENAI_API_KEY para generar anuncios.",
      };
    }

    const includeBusinessLogo =
      parsed.data.includeBusinessLogo === "on" || parsed.data.includeBusinessLogo === "true";
    const businessLogoUrl = includeBusinessLogo
      ? await getWorkspaceMarketingLogoUrl(membership.workspace.id)
      : null;

    const sourceImageUrl = await saveMarketingSourceImage(image);
    const creatives = await generateFacebookAdCreativesForProduct(
      {
        productId: `marketing-${randomUUID()}`,
        name: parsed.data.productName,
        description: parsed.data.productDescription,
        sourceImageUrl,
        brief: parsed.data.brief,
        brandLogoUrl: businessLogoUrl,
        includeBrandLogo: Boolean(includeBusinessLogo && businessLogoUrl),
        creativeMode: parsed.data.creativeMode,
      },
      apiKey,
    );

    return {
      ok: true,
      message: "Se generaron 3 anuncios listos para Facebook Ads.",
      creatives,
      sourceImageUrl,
      creativeMode: parsed.data.creativeMode,
    };
  } catch (error) {
    console.error("[MARKETING_FACEBOOK_ADS]", error);
    return {
      ...previousState,
      ok: false,
      message: resolveMarketingError(error),
    };
  }
}

export async function deleteFacebookAdsHistoryImagesAction(input: {
  imageUrls: string[];
  sourceImageUrl?: string;
}): Promise<{ ok: boolean; message: string }> {
  try {
    await requireMarketingWorkspace();

    const parsed = deleteCreativeImagesSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        message: "No se pudieron identificar las imagenes a eliminar.",
      };
    }

    const directories = Array.from(
      new Set(
        parsed.data.imageUrls
          .map(resolveCreativeDirectoryFromUrl)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );

    await deleteMarketingSourceImageFile(parsed.data.sourceImageUrl);

    return {
      ok: true,
      message: "Se elimino el registro, sus imagenes y la foto original.",
    };
  } catch (error) {
    console.error("[MARKETING_FACEBOOK_ADS_DELETE]", error);
    return {
      ok: false,
      message: "No se pudieron eliminar las imagenes del historial.",
    };
  }
}

export async function saveMarketingBusinessLogoAction(formData: FormData): Promise<void> {
  try {
    const membership = await requireMarketingWorkspace();
    const rawLogo = formData.get("logo");
    const logoFile = rawLogo instanceof File ? rawLogo : null;

    if (!logoFile) {
      redirect("/cliente/marketing-ia?error=Debes+subir+una+imagen+de+logo");
    }

    const nextLogoUrl = await saveMarketingBusinessLogo(logoFile);
    const currentLogoUrl = await getWorkspaceMarketingLogoUrl(membership.workspace.id);

    await setWorkspaceMarketingLogoUrl(membership.workspace.id, nextLogoUrl);

    if (currentLogoUrl && currentLogoUrl !== nextLogoUrl) {
      await deleteMarketingBusinessLogoFile(currentLogoUrl);
    }

    revalidatePath("/cliente/marketing-ia");
    revalidatePath("/cliente/marketing-ia/creativos");
    revalidatePath("/cliente/marketing-ia/facebook-ads");
    redirect("/cliente/marketing-ia?ok=Logo+de+marketing+actualizado");
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }

    console.error("[MARKETING_LOGO_SAVE]", error);
    redirect(`/cliente/marketing-ia?error=${encodeURIComponent(resolveMarketingError(error))}`);
  }
}

export async function deleteMarketingBusinessLogoAction(): Promise<void> {
  try {
    const membership = await requireMarketingWorkspace();
    const currentLogoUrl = await getWorkspaceMarketingLogoUrl(membership.workspace.id);

    await clearWorkspaceMarketingLogoUrl(membership.workspace.id);
    await deleteMarketingBusinessLogoFile(currentLogoUrl);

    revalidatePath("/cliente/marketing-ia");
    revalidatePath("/cliente/marketing-ia/creativos");
    revalidatePath("/cliente/marketing-ia/facebook-ads");
    redirect("/cliente/marketing-ia?ok=Logo+de+marketing+eliminado");
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }

    console.error("[MARKETING_LOGO_DELETE]", error);
    redirect(`/cliente/marketing-ia?error=${encodeURIComponent(resolveMarketingError(error))}`);
  }
}

export async function updateMarketingBusinessContextAction(formData: FormData): Promise<void> {
  try {
    const membership = await requireMarketingWorkspace();
    const parsed = marketingContextSchema.safeParse({
      valueProposition: formData.get("valueProposition"),
      idealCustomer: formData.get("idealCustomer"),
      painPoints: formData.get("painPoints"),
      mainOffer: formData.get("mainOffer"),
      primaryCallToAction: formData.get("primaryCallToAction"),
      websiteUrl: formData.get("websiteUrl") || "",
      instagramUrl: formData.get("instagramUrl") || "",
      facebookUrl: formData.get("facebookUrl") || "",
      tiktokUrl: formData.get("tiktokUrl") || "",
    });

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message || "No pudimos guardar la informacion del negocio.";
      redirect(`/cliente/marketing-ia/contexto-negocio?error=${encodeURIComponent(message)}`);
    }

    const workspaceId = membership.workspace.id;
    const entries = [
      ["marketingValueProposition", parsed.data.valueProposition],
      ["marketingIdealCustomer", parsed.data.idealCustomer],
      ["marketingPainPoints", parsed.data.painPoints],
      ["marketingMainOffer", parsed.data.mainOffer],
      ["marketingPrimaryCta", parsed.data.primaryCallToAction],
      ["marketingWebsiteUrl", parsed.data.websiteUrl],
      ["marketingInstagramUrl", parsed.data.instagramUrl],
      ["marketingFacebookUrl", parsed.data.facebookUrl],
      ["marketingTiktokUrl", parsed.data.tiktokUrl],
    ] as const;

    await Promise.all(
      entries.map(([setting, value]) =>
        prisma.appSetting.upsert({
          where: {
            key: getMarketingContextSettingKey(workspaceId, setting),
          },
          update: {
            value,
          },
          create: {
            key: getMarketingContextSettingKey(workspaceId, setting),
            value,
          },
        }),
      ),
    );

    revalidatePath("/cliente/marketing-ia");
    revalidatePath("/cliente/marketing-ia/contexto-negocio");
    revalidatePath("/cliente/marketing-ia/creativos");
    revalidatePath("/cliente/marketing-ia/ads-generator");
    redirect("/cliente/marketing-ia/contexto-negocio?ok=Informacion+de+marketing+actualizada");
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error;
    }

    console.error("[MARKETING_CONTEXT_UPDATE]", error);
    redirect("/cliente/marketing-ia/contexto-negocio?error=No+se+pudo+guardar+la+informacion+del+negocio");
  }
}
