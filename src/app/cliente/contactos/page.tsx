import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Users2 } from "lucide-react";
import { ContactAvatar } from "@/components/chats/contact-avatar";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getContactosData } from "@/features/contactos";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

// Contactos v2 (en reconstrucción): por ahora, una sola columna de cards con
// avatar redondo, nombre y teléfono. El detalle por página llegará después.
export default async function ClienteContactosPage() {
  const access = await requireClientWorkspaceAccess("contacts");

  const data = await getContactosData({ userId: access.userId });
  if (!data) {
    redirect("/cliente");
  }

  return (
    <section className="space-y-4 p-4 md:p-6">
      <PageHeader icon={Users2} title="Contactos" />

      <div className="flex flex-col gap-3">
        {data.contacts.length > 0 ? (
          data.contacts.map((contact) => {
            const displayName = contact.name?.trim() || contact.phoneNumber;

            return (
              <Card key={contact.id} className="py-0 transition hover:bg-accent/50">
                <CardContent className="flex items-center gap-3 py-3.5">
                  <ContactAvatar
                    avatarUrl={contact.avatarUrl}
                    label={displayName}
                    className="h-11 w-11 shrink-0 rounded-full"
                    fallbackClassName="rounded-full"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                    <p className="truncate text-xs tabular-nums text-muted-foreground">{contact.phoneNumber}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Aun no hay contactos para mostrar.
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}
