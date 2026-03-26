import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, BadgeCheck, ImagePlus, Megaphone } from "lucide-react";
import { auth } from "@/auth";
import {
  deleteMarketingBusinessLogoAction,
  saveMarketingBusinessLogoAction,
} from "@/app/actions/marketing-actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { getWorkspaceMarketingLogoUrl } from "@/lib/marketing-branding";
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

export default async function MarketingIaPage({ searchParams }: PageProps) {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  const businessLogoUrl = membership
    ? await getWorkspaceMarketingLogoUrl(membership.workspace.id)
    : null;
  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  return (
    <MarketingPageContent
      businessLogoUrl={businessLogoUrl}
      okMessage={okMessage}
      errorMessage={errorMessage}
    />
  );
}

function MarketingPageContent({
  okMessage,
  errorMessage,
}: {
  businessLogoUrl: string | null;
  okMessage: string;
  errorMessage: string;
}) {
  return (
    <section className="app-page space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Marketing actualizado"
        errorTitle="No pudimos completar la accion"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
            <Megaphone className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Facebook Ads</h2>
          <div className="space-y-1">
          </div>
          <Link
            href="/cliente/marketing-ia/facebook-ads"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            Abrir modulo
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Card>
      </div>
    </section>
  );
}
