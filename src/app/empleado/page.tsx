import type { Metadata } from "next";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function EmpleadoPage() {
  return (
    <section className="app-page space-y-5">
      <Card className="max-w-3xl space-y-2.5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">Dashboard Empleado</h1>
        <p className="text-sm text-slate-600 md:text-base">
          Vista operativa para seguimiento de tareas, clientes asignados y actividad diaria.
        </p>
      </Card>
    </section>
  );
}
