"use server";

import { z } from "zod";
import { auth } from "@/auth";
import { generateAdCreativesForProduct, type AdCreative } from "@/lib/ad-creatives";
import { hasAdminModuleAccess } from "@/lib/admin-module-access";
import { prisma } from "@/lib/prisma";

export type ProductAdCreativeActionState = {
  ok: boolean;
  message: string;
  creatives: AdCreative[];
};

const generateProductCreativeSchema = z.object({
  productId: z.string().trim().min(1, "Producto invalido"),
  sourceImageUrl: z.string().trim().min(1, "Selecciona una imagen"),
  brief: z.string().trim().max(240, "Las instrucciones extra son demasiado largas").optional(),
});

async function requireAdminProductsAccess() {
  const session = await auth();

  if (session?.user?.role !== "ADMIN" || !session.user.id) {
    throw new Error("No autorizado");
  }

  const canAccess = await hasAdminModuleAccess(session.user.id, session.user.role, "products");
  if (!canAccess) {
    throw new Error("No autorizado");
  }

  return session;
}

function resolveCreativeGenerationError(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("No autorizado")) {
    return "No tienes permisos para generar creativos.";
  }

  if (message.includes("OpenAI image 400")) {
    return "No se pudo generar una de las imagenes. Prueba con otra foto o una instruccion mas simple.";
  }

  if (message.includes("OpenAI image 401")) {
    return "La integracion con OpenAI no esta autorizada.";
  }

  if (message.includes("OpenAI image 429")) {
    return "OpenAI esta recibiendo demasiadas solicitudes. Intenta de nuevo en un momento.";
  }

  if (message.includes("imagen del producto")) {
    return message;
  }

  return "No se pudieron generar los creativos en este momento.";
}

export async function generateProductFacebookAdsAction(
  previousState: ProductAdCreativeActionState,
  formData: FormData,
): Promise<ProductAdCreativeActionState> {
  try {
    await requireAdminProductsAccess();

    const parsed = generateProductCreativeSchema.safeParse({
      productId: formData.get("productId"),
      sourceImageUrl: formData.get("sourceImageUrl"),
      brief: formData.get("brief") || undefined,
    });

    if (!parsed.success) {
      return {
        ...previousState,
        ok: false,
        message: parsed.error.issues[0]?.message || "Datos invalidos",
      };
    }

    const product = await prisma.product.findUnique({
      where: { id: parsed.data.productId },
      include: {
        category: true,
        images: {
          orderBy: { order: "asc" },
        },
      },
    });

    if (!product) {
      return {
        ...previousState,
        ok: false,
        message: "El producto ya no existe.",
      };
    }

    const allowedImages = new Set([
      product.thumbnailUrl,
      ...product.images.map((image) => image.url),
    ]);

    if (!allowedImages.has(parsed.data.sourceImageUrl)) {
      return {
        ...previousState,
        ok: false,
        message: "Selecciona una imagen guardada del producto.",
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

    const creatives = await generateAdCreativesForProduct(
      {
        productId: product.id,
        name: product.name,
        description: product.description,
        categoryName: product.category?.name ?? null,
        sourceImageUrl: parsed.data.sourceImageUrl,
        brief: parsed.data.brief,
      },
      apiKey,
    );

    return {
      ok: true,
      message: "Se generaron 3 creativos listos para Meta Ads.",
      creatives,
    };
  } catch (error) {
    console.error("[PRODUCT_META_ADS]", error);
    return {
      ...previousState,
      ok: false,
      message: resolveCreativeGenerationError(error),
    };
  }
}
