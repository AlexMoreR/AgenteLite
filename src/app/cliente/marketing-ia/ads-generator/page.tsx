import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AdsGeneratorWorkspace } from "@/features/ads-generator";
import type { AdProductInput } from "@/features/ads-generator";
import { getAdsGeneratorHistory } from "@/lib/ads-generator-history";
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

export default async function AdsGeneratorPage({ searchParams }: PageProps) {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const params = await searchParams;
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  const imageUrl = getSingleValue(params.imageUrl);
  const source = getSingleValue(params.source);
  const history = membership?.workspace.id
    ? await getAdsGeneratorHistory(membership.workspace.id)
    : [];
  const initialInput: Partial<AdProductInput> = {
    productName: getSingleValue(params.productName),
    productDescription: getSingleValue(params.productDescription),
    keyBenefits: splitLines(getSingleValue(params.keyBenefits)),
    painPoints: splitLines(getSingleValue(params.painPoints)),
    audienceSummary: getSingleValue(params.audienceSummary) || undefined,
    image: imageUrl
      ? {
          url: imageUrl,
          alt: getSingleValue(params.productName) || "Imagen del producto",
          source: source === "upload" || source === "external" ? source : "creativos",
          isPrimary: true,
        }
      : null,
  };

  return (
    <AdsGeneratorWorkspace
      initialHistory={history}
      initialInput={initialInput}
      sourceHint={source ? `imagen enviada desde ${source}` : null}
    />
  );
}
