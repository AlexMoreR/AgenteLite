import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SimpleMarketingForm } from "@/components/marketing/simple-marketing-form";

export function FacebookAdsWorkspace() {
  return (
    <section className="app-page space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Link
          href="/cliente/marketing-ia"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a Marketing IA
        </Link>
      </div>

      <SimpleMarketingForm />
    </section>
  );
}
