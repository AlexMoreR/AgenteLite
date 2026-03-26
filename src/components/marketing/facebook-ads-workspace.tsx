import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SimpleMarketingForm } from "@/components/marketing/simple-marketing-form";

export function FacebookAdsWorkspace() {
  return (
    <section className="app-page space-y-6">
      <div className="relative overflow-hidden rounded-[34px] border border-[rgba(87,72,117,0.14)] bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(247,242,255,0.95)_42%,rgba(239,234,246,0.98))] px-5 py-5 shadow-[0_34px_90px_-54px_rgba(40,18,78,0.28)] sm:px-6 sm:py-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(126,34,206,0.12),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(249,115,22,0.12),transparent_26%)]" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/cliente/marketing-ia"
            className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[rgba(87,72,117,0.12)] bg-white/84 px-4 text-sm font-medium text-slate-700 transition hover:bg-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver a Marketing IA
          </Link>
        </div>
      </div>

      <SimpleMarketingForm />
    </section>
  );
}
