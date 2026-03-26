import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Megaphone } from "lucide-react";
import { auth } from "@/auth";
import { Card } from "@/components/ui/card";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";

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

  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  return <MarketingPageContent okMessage={okMessage} errorMessage={errorMessage} />;
}

function MarketingPageContent({
  okMessage,
  errorMessage,
}: {
  okMessage: string;
  errorMessage: string;
}) {
  return (
    <section className="app-page space-y-6">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Marketing actualizado"
        errorTitle="No pudimos completar la accion"
      />

      <div className="relative overflow-hidden rounded-[36px] border border-[rgba(87,72,117,0.14)] bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.96),rgba(248,244,255,0.94)_38%,rgba(240,237,247,0.96)_100%)] p-5 shadow-[0_40px_100px_-56px_rgba(37,16,84,0.34)] sm:p-6 lg:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.34),transparent_38%,rgba(116,45,202,0.08)_100%)]" />
        <div className="pointer-events-none absolute -right-14 top-[-72px] h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(126,34,206,0.16),rgba(126,34,206,0))]" />
        <div className="pointer-events-none absolute -left-16 bottom-[-90px] h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(251,146,60,0.14),rgba(251,146,60,0))]" />

        <div className="relative">
          <Card className="relative overflow-hidden rounded-[30px] border-[rgba(87,72,117,0.14)] bg-[linear-gradient(160deg,rgba(23,25,35,0.96),rgba(58,33,84,0.95)_54%,rgba(240,100,67,0.82)_140%)] p-5 text-white shadow-[0_30px_80px_-48px_rgba(35,16,73,0.54)] sm:p-6">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.24),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.12),transparent_28%)]" />
            <div className="relative space-y-6">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-[20px] bg-white/12 text-white backdrop-blur">
                <Megaphone className="h-5 w-5" />
              </div>

              <div className="space-y-2">
                <h2 className="text-[1.75rem] font-semibold tracking-[-0.06em] text-white">Facebook Ads</h2>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[22px] border border-white/10 bg-white/8 px-4 py-4 backdrop-blur">
                  <div className="h-1.5 w-10 rounded-full bg-white/55" />
                </div>
                <div className="rounded-[22px] border border-white/10 bg-white/8 px-4 py-4 backdrop-blur">
                  <div className="h-1.5 w-16 rounded-full bg-white/55" />
                </div>
                <div className="rounded-[22px] border border-white/10 bg-white/8 px-4 py-4 backdrop-blur">
                  <div className="h-1.5 w-12 rounded-full bg-white/55" />
                </div>
              </div>

              <Link
                href="/cliente/marketing-ia/facebook-ads"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-medium text-slate-900 transition hover:bg-white/90"
              >
                Abrir modulo
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
