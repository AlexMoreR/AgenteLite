import { redirect } from "next/navigation";
import { MapPin, Save, Tag } from "lucide-react";
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
      <span className="h-4 w-1 rounded-full bg-[var(--primary)]" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</span>
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
        {/* La accion exige el nombre del negocio; este formulario no lo edita, asi que va oculto
            con el valor actual (sin esto, guardar desde aca fallaba con "Nombre invalido"). */}
        <input type="hidden" name="businessName" value={workspace.name} />

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

        {/* Ubicacion del local: se carga UNA vez y despues las asesoras la mandan desde el chat
            con un toque (menu "+" → "Ubicacion del local"). WhatsApp necesita coordenadas, por eso
            se pide el link de Google Maps y no solo la direccion escrita. */}
        <div className="space-y-3">
          <SectionHeader title="Ubicación del local" />
          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <MapPin className="size-4" />
                </span>
                <div className="space-y-1">
                  <CardTitle>Enviar ubicación por WhatsApp</CardTitle>
                  <CardDescription>
                    Pegá el link de Google Maps de tu local. Después, en cualquier chat, con el
                    botón <span className="font-medium text-foreground">+ → Ubicación del local</span> se
                    envía el pin al cliente en un toque.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="locationMaps">Link de Google Maps (o coordenadas)</Label>
                <Input
                  id="locationMaps"
                  name="locationMaps"
                  defaultValue={
                    config.locationLatitude && config.locationLongitude
                      ? `${config.locationLatitude}, ${config.locationLongitude}`
                      : ""
                  }
                  placeholder="Ej. https://maps.app.goo.gl/... o 10.9878, -74.7889"
                />
                <p className="text-sm text-muted-foreground">
                  {config.locationLatitude && config.locationLongitude
                    ? "✅ Ubicación cargada. Podés pegar otro link para cambiarla, o vaciar el campo para quitarla."
                    : "Todavía no hay ubicación cargada: el botón del chat va a pedir que la configures acá."}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="locationLabel">Nombre que ve el cliente</Label>
                  <Input
                    id="locationLabel"
                    name="locationLabel"
                    defaultValue={config.locationLabel}
                    placeholder={workspace.name}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="locationAddress">Dirección que ve el cliente</Label>
                  <Input
                    id="locationAddress"
                    name="locationAddress"
                    defaultValue={config.locationAddress}
                    placeholder="Ej. Carrera 27 #72x-25"
                  />
                </div>
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
