import type { Metadata } from "next";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function ClientePage() {
  return (
    <section className="app-page space-y-5">
      <Card className="max-w-3xl space-y-2.5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">Dashboard Cliente</h1>
        <p className="text-sm text-slate-600 md:text-base">
          Panel para revisar informacion de cuenta, solicitudes y estado de operaciones.
        </p>
      </Card>
    </section>
  );
}
