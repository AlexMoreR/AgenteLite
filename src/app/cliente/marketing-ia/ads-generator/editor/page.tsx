import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AdsGeneratorWorkspace } from "@/features/ads-generator";
import type { AdProductInput } from "@/features/ads-generator";
import { getAdsGeneratorHistory } from "@/lib/ads-generator-history";
import { getMarketingBusinessContextForUser } from "@/lib/marketing-business-context";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getSingleValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default async function AdsGeneratorEditorPage({ searchParams }: PageProps) {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    redirect("/cliente/marketing-ia/ads-generator");
  }

  const params = await searchParams;
  const businessContext = await getMarketingBusinessContextForUser(session.user.id);
  const history = await getAdsGeneratorHistory(membership.workspace.id);
  const entryId = getSingleValue(params.entryId);
  const selectedEntry = entryId ? history.find((entry) => entry.id === entryId) : null;

  const imageUrl = getSingleValue(params.imageUrl);
  const source = getSingleValue(params.source);

  const initialInput: Partial<AdProductInput> = {
    ...selectedEntry?.input,
    productName: getSingleValue(params.productName) || selectedEntry?.input.productName || "",
    productDescription: getSingleValue(params.productDescription) || selectedEntry?.input.productDescription || "",
    brandName: selectedEntry?.input.brandName || businessContext?.businessName || undefined,
    categoryName: selectedEntry?.input.categoryName || businessContext?.businessType || undefined,
    keyBenefits:
      splitLines(getSingleValue(params.keyBenefits)).length > 0
        ? splitLines(getSingleValue(params.keyBenefits))
        : selectedEntry?.input.keyBenefits || [],
    painPoints:
      splitLines(getSingleValue(params.painPoints)).length > 0
        ? splitLines(getSingleValue(params.painPoints))
        : selectedEntry?.input.painPoints || [],
    audienceSummary:
      getSingleValue(params.audienceSummary) ||
      selectedEntry?.input.audienceSummary ||
      businessContext?.idealCustomer ||
      (businessContext?.targetAudiences.length
        ? businessContext.targetAudiences.join(", ")
        : undefined),
    landingPageUrl: selectedEntry?.input.landingPageUrl || businessContext?.websiteUrl || undefined,
    callToAction: selectedEntry?.input.callToAction || businessContext?.primaryCallToAction || undefined,
    image: imageUrl
      ? {
          url: imageUrl,
          alt: getSingleValue(params.productName) || selectedEntry?.input.productName || "Imagen del producto",
          source: source === "upload" || source === "external" ? source : "creativos",
          isPrimary: true,
        }
      : selectedEntry?.input.image || null,
  };

  return (
    <AdsGeneratorWorkspace
      initialInput={initialInput}
      businessContext={businessContext}
      historyEntryId={selectedEntry?.id ?? null}
      draftStorageKeySuffix={selectedEntry?.id ?? getSingleValue(params.productName) ?? "new-ad"}
    />
  );
}
