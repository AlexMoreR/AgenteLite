"use server";

import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { auth } from "@/auth";
import {
  generateFacebookAdCreativesForProduct,
  type FacebookAdCreative,
} from "@/lib/facebook-ad-creatives";

export type FacebookAdsGeneratorState = {
  ok: boolean;
  message: string;
  creatives: FacebookAdCreative[];
};

const generateFacebookAdsSchema = z.object({
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
});

const deleteCreativeImagesSchema = z.object({
  imageUrls: z.array(z.string().trim().min(1)).min(1).max(24),
});

async function requireMarketingAccess() {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    throw new Error("No autorizado");
  }
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
    await requireMarketingAccess();

    const parsed = generateFacebookAdsSchema.safeParse({
      productName: formData.get("productName"),
      productDescription: formData.get("productDescription") || undefined,
      brief: formData.get("brief") || undefined,
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

    const sourceImageUrl = await saveMarketingSourceImage(image);
    const creatives = await generateFacebookAdCreativesForProduct(
      {
        productId: `marketing-${randomUUID()}`,
        name: parsed.data.productName,
        description: parsed.data.productDescription,
        sourceImageUrl,
        brief: parsed.data.brief,
      },
      apiKey,
    );

    return {
      ok: true,
      message: "Se generaron 3 anuncios listos para Facebook Ads.",
      creatives,
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
}): Promise<{ ok: boolean; message: string }> {
  try {
    await requireMarketingAccess();

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

    return {
      ok: true,
      message: "Se elimino el registro y sus imagenes.",
    };
  } catch (error) {
    console.error("[MARKETING_FACEBOOK_ADS_DELETE]", error);
    return {
      ok: false,
      message: "No se pudieron eliminar las imagenes del historial.",
    };
  }
}
