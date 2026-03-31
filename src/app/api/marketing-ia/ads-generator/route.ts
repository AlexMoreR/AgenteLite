import { randomUUID } from "node:crypto";
import { rm, unlink } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { runAdsGenerator } from "@/features/ads-generator";
import type { AdProductInput } from "@/features/ads-generator";
import { deleteAdsGeneratorHistoryEntry, getAdsGeneratorHistory, saveAdsGeneratorHistoryEntry } from "@/lib/ads-generator-history";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

const adImageSchema = z.object({
  url: z.string().trim().min(1),
  alt: z.string().trim().optional(),
  source: z.enum(["creativos", "upload", "external"]),
  isPrimary: z.boolean().optional(),
});

const adInputSchema: z.ZodType<AdProductInput> = z.object({
  productId: z.string().trim().optional(),
  productName: z.string().trim().min(2),
  productDescription: z.string().trim().min(8),
  brandName: z.string().trim().optional(),
  categoryName: z.string().trim().optional(),
  price: z.number().finite().nonnegative().optional(),
  currency: z.string().trim().optional(),
  landingPageUrl: z.string().trim().optional(),
  objective: z.enum(["traffic", "sales", "leads", "engagement"]).optional(),
  audienceSummary: z.string().trim().optional(),
  tone: z.enum(["direct", "persuasive", "premium", "friendly"]).optional(),
  keyBenefits: z.array(z.string().trim().min(1)).min(1),
  painPoints: z.array(z.string().trim().min(1)).optional(),
  callToAction: z.string().trim().optional(),
  image: adImageSchema.nullable(),
});

const deleteSchema = z.object({
  id: z.string().trim().min(1),
});

const assetsSchema = z.object({
  sourceImageUrl: z.string().trim().min(1).optional(),
  creativeImageUrls: z.array(z.string().trim().min(1)).default([]),
});

const postSchema = z.union([
  adInputSchema,
  z.object({
    entryId: z.string().trim().min(1).optional(),
    input: adInputSchema,
    assets: assetsSchema.optional(),
  }),
  z.object({
    draft: z.literal(true),
    productName: z.string().trim().min(2),
  }),
]);

async function requireMarketingWorkspace() {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return null;
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  return membership?.workspace.id ? membership : null;
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

async function deleteMarketingSourceImageFile(sourceImageUrl: string | null | undefined) {
  if (!sourceImageUrl || !sourceImageUrl.startsWith("/uploads/marketing-source/")) {
    return;
  }

  const normalizedPath = path.normalize(sourceImageUrl).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(process.cwd(), "public", normalizedPath);

  try {
    await unlink(filePath);
  } catch {
    // Ignore missing files; clearing the history entry remains the priority.
  }
}

export async function GET() {
  const membership = await requireMarketingWorkspace();
  if (!membership) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const history = await getAdsGeneratorHistory(membership.workspace.id);
  return NextResponse.json({ history });
}

export async function POST(request: Request) {
  const membership = await requireMarketingWorkspace();
  if (!membership) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Entrada invalida" },
      { status: 400 },
    );
  }

  if ("draft" in parsed.data) {
    const entry = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      input: {
        productName: parsed.data.productName,
        productDescription: `${parsed.data.productName}.`,
        keyBenefits: ["Pendiente por definir"],
        image: null,
      },
      result: {
        summary: "Anuncio IA creado como borrador.",
        strategy: {
          angle: "Pendiente por definir",
          audience: "Pendiente por definir",
          hooks: ["Pendiente por definir"],
          callToAction: "Pendiente por definir",
        },
        meta: {
          campaignObjective: "Pendiente por definir",
          strategicSummary: "Pendiente por definir",
          recommendedSalesAngle: "Pendiente por definir",
          campaignStructure: "Pendiente por definir",
          basicSegmentation: [],
          recommendedFormat: "Pendiente por definir",
          primaryText: "Pendiente de publicar",
          headline: "Pendiente de publicar",
          description: "Completa el anuncio",
          callToAction: "Pendiente por definir",
          creativeIdea: "Pendiente por definir",
          budgetRecommendation: "Pendiente por definir",
          primaryMetric: "Pendiente por definir",
          creativeNotes: [],
          publicationChecklist: [],
          copyVariants: [],
          readyToCopyText: "",
        },
      },
    };

    const history = await saveAdsGeneratorHistoryEntry(membership.workspace.id, entry);

    return NextResponse.json({
      entry,
      history,
    });
  }

  const entryId = "input" in parsed.data ? parsed.data.entryId : undefined;
  const input = "input" in parsed.data ? parsed.data.input : parsed.data;
  const assets = "input" in parsed.data ? parsed.data.assets : undefined;
  const result = await runAdsGenerator(input);
  const currentHistory = await getAdsGeneratorHistory(membership.workspace.id);
  const currentEntry = entryId ? currentHistory.find((item) => item.id === entryId) : null;
  const entry = {
    id: currentEntry?.id ?? randomUUID(),
    createdAt: currentEntry?.createdAt ?? new Date().toISOString(),
    input,
    result,
    assets: assets ?? currentEntry?.assets,
  };

  const history = await saveAdsGeneratorHistoryEntry(membership.workspace.id, entry);

  return NextResponse.json({
    entry,
    history,
  });
}

export async function DELETE(request: Request) {
  const membership = await requireMarketingWorkspace();
  if (!membership) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = deleteSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: "Id invalido" }, { status: 400 });
  }

  const currentHistory = await getAdsGeneratorHistory(membership.workspace.id);
  const entry = currentHistory.find((item) => item.id === parsed.data.id);
  const history = await deleteAdsGeneratorHistoryEntry(membership.workspace.id, parsed.data.id);

  if (entry) {
    const directories = Array.from(
      new Set(
        (entry.assets?.creativeImageUrls ?? [])
          .map(resolveCreativeDirectoryFromUrl)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
    await deleteMarketingSourceImageFile(
      entry.assets?.sourceImageUrl ??
        (entry.input.image?.source === "upload" ? entry.input.image.url : undefined),
    );
  }

  return NextResponse.json({ history });
}
