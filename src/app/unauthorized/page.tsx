import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function UnauthorizedPage() {
  return (
    <section className="app-page grid min-h-[70vh] place-items-center">
      <Card className="max-w-md space-y-4 border-[var(--danger-line)] text-center">
        <h1 className="text-2xl font-semibold">Sin autorizacion</h1>
        <p className="text-slate-600">
          No tienes permisos para acceder a esta ruta.
        </p>
        <Button asChild className="w-full">
          <Link href="/">Volver al inicio</Link>
        </Button>
      </Card>
    </section>
  );
}
