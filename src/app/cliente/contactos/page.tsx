import type { Metadata } from "next";
import { Users2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

// Pantalla en blanco a propósito: el diseño anterior de Contactos se retiró y el
// módulo se reconstruirá desde cero (lista de cards + página de detalle dedicada).
export default async function ClienteContactosPage() {
  await requireClientWorkspaceAccess("contacts");

  return (
    <section className="space-y-4 p-4 md:p-6">
      <PageHeader icon={Users2} title="Contactos" />
    </section>
  );
}
