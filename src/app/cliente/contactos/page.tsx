import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, MoreVertical, Search, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { getContactosData } from "@/features/contactos";
import { ContactosCardsList } from "@/features/contactos/components/ContactosCardsList";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Contactos v2 (en reconstrucción): columna de cards con avatar redondo, nombre y
// teléfono; buscador y menú (Informe) en la fila del título.
export default async function ClienteContactosPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("contacts");

  const params = await searchParams;
  const searchQuery = typeof params.q === "string" ? params.q.trim() : "";
  const activeView = params.view === "informe" ? "informe" : "contacto";

  const data = await getContactosData({ userId: access.userId, searchQuery });
  if (!data) {
    redirect("/cliente");
  }

  return (
    <section className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader icon={Users2} title="Contactos" />

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">
          <form method="get" className="relative w-full max-w-xs sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              defaultValue={searchQuery}
              placeholder="Buscar contacto"
              className="h-9 pl-8"
              aria-label="Buscar contactos"
            />
          </form>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon" aria-label="Más opciones de contactos">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem asChild className="gap-2">
                <Link href="/cliente/contactos?view=informe">
                  <BarChart3 className="h-4 w-4" />
                  Informe
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {activeView === "informe" ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            El informe de contactos está en reconstrucción.
          </CardContent>
        </Card>
      ) : (
        <>
          {data.contacts.length > 0 ? (
            <ContactosCardsList
              contacts={data.contacts.map((contact) => ({
                id: contact.id,
                name: contact.name,
                phoneNumber: contact.phoneNumber,
                email: contact.email,
                avatarUrl: contact.avatarUrl,
                profile: contact.profile,
                createdAt: contact.createdAt,
                lastActivityAt: contact.lastActivityAt,
                tags: contact.tags,
              }))}
            />
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {searchQuery ? "Sin resultados para la búsqueda." : "Aun no hay contactos para mostrar."}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </section>
  );
}
