import { randomUUID } from "node:crypto";
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

async function requireMarketingWorkspace() {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return null;
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  return membership?.workspace.id ? membership : null;
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
  const parsed = adInputSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Entrada invalida" },
      { status: 400 },
    );
  }

  const result = await runAdsGenerator(parsed.data);
  const entry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    input: parsed.data,
    result,
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

  const history = await deleteAdsGeneratorHistoryEntry(membership.workspace.id, parsed.data.id);
  return NextResponse.json({ history });
}
