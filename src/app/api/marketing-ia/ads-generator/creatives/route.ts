import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateFacebookAdCreativesForProduct } from "@/lib/facebook-ad-creatives";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

async function requireMarketingWorkspace() {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return null;
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  return membership?.workspace.id ? membership : null;
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

function inferProductName(value: string) {
  const cleaned = value
    .trim()
    .replace(/\s+/g, " ")
    .split(/[.,:;!?]/)[0]
    ?.trim();

  if (!cleaned) {
    return "Producto del anuncio";
  }

  return cleaned.split(" ").slice(0, 6).join(" ");
}

export async function POST(request: Request) {
  const membership = await requireMarketingWorkspace();
  if (!membership) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "No pudimos leer la solicitud" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Falta configurar OPENAI_API_KEY para generar creativos." },
      { status: 500 },
    );
  }

  const image = formData.get("image");
  const sourceImageUrlRaw = String(formData.get("sourceImageUrl") ?? "").trim();
  const prompt = String(formData.get("prompt") ?? "").trim();
  const productNameRaw = String(formData.get("productName") ?? "").trim();
  const creativeModeRaw = String(formData.get("creativeMode") ?? "real").trim();
  const creativeCountRaw = Number(formData.get("creativeCount") ?? 3);
  const creativeMode =
    creativeModeRaw === "creative" || creativeModeRaw === "inspired" ? creativeModeRaw : "real";
  const creativeCount =
    Number.isFinite(creativeCountRaw) && [3, 5, 10].includes(creativeCountRaw) ? creativeCountRaw : 3;

  let sourceImageUrl = sourceImageUrlRaw;

  try {
    if (image instanceof File && image.size > 0) {
      sourceImageUrl = await saveMarketingSourceImage(image);
    }

    if (!sourceImageUrl) {
      return NextResponse.json(
        { error: "Debes subir una imagen o venir con una imagen desde Creativos." },
        { status: 400 },
      );
    }

    const productName = productNameRaw || inferProductName(prompt);
    const productDescription = prompt || "Anuncio generado desde el Ads Generator.";

    const creatives = await generateFacebookAdCreativesForProduct(
      {
        productId: `ads-generator-${randomUUID()}`,
        name: productName,
        description: productDescription,
        sourceImageUrl,
        brief: prompt || productName,
        creativeMode,
        creativeCount,
      },
      apiKey,
    );

    return NextResponse.json({
      creatives,
      sourceImageUrl,
    });
  } catch (error) {
    console.error("[ADS_GENERATOR_CREATIVES]", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No pudimos generar los creativos en este momento.",
      },
      { status: 500 },
    );
  }
}
