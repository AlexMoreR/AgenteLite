import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SimpleMarketingForm } from "@/components/marketing/simple-marketing-form";

export function FacebookAdsWorkspace() {
  return (
    <section className="app-page space-y-6">
      <SimpleMarketingForm />
    </section>
  );
}
