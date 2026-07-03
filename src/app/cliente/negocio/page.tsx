import { redirect } from "next/navigation";
import { Save, Tag } from "lucide-react";
import { auth } from "@/auth";
import { saveWorkspaceBusinessConfigAction } from "@/app/actions/workspace-actions";
import { BusinessChatsCleanupMenu } from "./BusinessChatsCleanupMenu";
import { NegocioEquipoTabs } from "@/components/negocio-equipo-tabs";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { parseWorkspaceBusinessConfig } from "@/lib/workspace-business-config";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-4 w-1 rounded-full bg-primary" />
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</span>
    </div>
  );
}

export default async function MiNegocioPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/onboarding");
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: membership.workspace.id },
    select: { id: true, name: true, businessConfig: true },
  });

  if (!workspace) {
    redirect("/cliente/onboarding");
  }

  const config = parseWorkspaceBusinessConfig(workspace.businessConfig);
  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <NegocioEquipoTabs />

      <form action={saveWorkspaceBusinessConfigAction} className="space-y-5">

        <div className="space-y-3">
          <SectionHeader title="Automatizaciones base" />
          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Tag className="size-4" />
                </span>
                <div className="space-y-1">
                  <CardTitle>Nuevo lead por defecto</CardTitle>
                  <CardDescription>
                    Cuando entra un contacto nuevo por WhatsApp, el sistema puede asignarle esta etiqueta de forma automática.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newLeadTagName">Nombre de la etiqueta</Label>
                <Input
                  id="newLeadTagName"
                  name="newLeadTagName"
                  defaultValue={config.newLeadTagName}
                  placeholder="Ej. Nuevo lead"
                />
              </div>

              <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                <div className="space-y-1">
                  <Label htmlFor="autoTagNewLeads">Activar etiqueta automática</Label>
                  <p className="text-sm text-muted-foreground">
                    Se creará y asignará la etiqueta{" "}
                    <span className="font-medium text-foreground">Nuevo lead</span> solo en contactos que aparezcan por primera vez.
                  </p>
                </div>
                <Switch id="autoTagNewLeads" name="autoTagNewLeads" defaultChecked={config.autoTagNewLeads} />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            El menu de acciones del negocio queda disponible aqui abajo para tareas sensibles.
          </p>
          <div className="flex items-center gap-2">
            <BusinessChatsCleanupMenu />
            <Button type="submit">
              <Save />
              Guardar
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
