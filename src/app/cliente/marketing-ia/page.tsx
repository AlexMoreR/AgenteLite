import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Megaphone, Sparkles } from "lucide-react";
import { auth } from "@/auth";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function MarketingIaPage() {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  return (
    <section className="app-page space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
            <Megaphone className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">Facebook Ads</h2>
            <p className="text-sm text-slate-600">
              Sube una foto del producto y genera 3 imagenes cuadradas con texto
              publicitario integrado para vender mejor.
            </p>
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
