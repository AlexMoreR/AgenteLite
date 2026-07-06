"use client";

import { useState } from "react";
import { Info, MessageSquareMore, Save, Settings2 } from "lucide-react";
import { adminUpdateEvolutionSettingsAction } from "@/app/actions/settings-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type WhatsAppConnectionsSettingsProps = {
  settings: {
    apiBaseUrl: string;
    apiToken: string;
    instancePrefix: string;
    webhookBaseUrl: string;
  };
};

export function WhatsAppConnectionsSettings({ settings }: WhatsAppConnectionsSettingsProps) {
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [goOpen, setGoOpen] = useState(false);

  const goConfigured = Boolean(settings.apiBaseUrl.trim() && settings.apiToken.trim());

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border border-[var(--line)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcfd_100%)] shadow-[0_20px_44px_-38px_rgba(15,23,42,0.18)]">
          <CardHeader>
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
              <MessageSquareMore className="h-5 w-5" />
            </div>
            <CardAction>
              <Badge variant="outline">Legado</Badge>
            </CardAction>
            <CardTitle>Conexion Evolution</CardTitle>
            <CardDescription>
              Espacio reservado para integraciones heredadas o migraciones desde Evolution API clasico.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3">
              Este bloque queda separado para no mezclar la configuracion moderna de Evolution Go con una conexion anterior.
            </div>
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <span className="text-xs text-slate-500">No impacta la configuracion activa actual.</span>
            <Button type="button" variant="outline" onClick={() => setLegacyOpen(true)}>
              <Info className="h-4 w-4" />
              Ver detalle
            </Button>
          </CardFooter>
        </Card>

        <Card className="border border-[var(--line)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcfd_100%)] shadow-[0_20px_44px_-38px_rgba(15,23,42,0.18)]">
          <CardHeader>
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
              <Settings2 className="h-5 w-5" />
            </div>
            <CardAction>
              <Badge variant={goConfigured ? "default" : "outline"}>{goConfigured ? "Configurado" : "Pendiente"}</Badge>
            </CardAction>
            <CardTitle>Conexion Evolution Go</CardTitle>
            <CardDescription>
              Conexion global usada por la aplicacion para crear y operar instancias de WhatsApp.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">URL base</p>
              <p className="mt-1 truncate text-sm font-medium text-slate-900">
                {settings.apiBaseUrl || "Sin configurar"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">Webhook</p>
              <p className="mt-1 break-all text-sm text-slate-700">
                {settings.webhookBaseUrl || "No configurado por entorno"}
              </p>
            </div>
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <span className="text-xs text-slate-500">Incluye URL base, token global y prefijo de instancias.</span>
            <Button type="button" onClick={() => setGoOpen(true)}>
              <Settings2 className="h-4 w-4" />
              Configurar
            </Button>
          </CardFooter>
        </Card>
      </div>

      <Dialog open={legacyOpen} onOpenChange={setLegacyOpen}>
        <DialogContent className="w-[min(92vw,36rem)] max-w-none border border-border bg-popover p-0 shadow-[0_30px_80px_-36px_rgba(15,23,42,0.45)]">
          <div className="space-y-5 p-5">
            <DialogHeader className="text-left">
              <DialogTitle>Conexion Evolution</DialogTitle>
              <DialogDescription>
                Este espacio queda separado para compatibilidad con una integracion heredada. La conexion activa recomendada es Evolution Go.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
              Si en algun momento quieres soportar ambos proveedores, aqui podemos añadir su configuracion sin mezclarla con el flujo nuevo.
            </div>
          </div>

          <DialogFooter className="-mx-0 -mb-0 border-t-0 bg-transparent px-5 pt-0 pb-5">
            <Button type="button" variant="outline" onClick={() => setLegacyOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={goOpen} onOpenChange={setGoOpen}>
        <DialogContent className="w-[min(94vw,42rem)] max-w-none border border-border bg-popover p-0 shadow-[0_30px_80px_-36px_rgba(15,23,42,0.45)]">
          <form action={adminUpdateEvolutionSettingsAction} className="space-y-0">
            <div className="space-y-5 p-5">
              <DialogHeader className="text-left">
                <DialogTitle>Configurar Evolution Go</DialogTitle>
                <DialogDescription>
                  Ajusta la conexion global y revisa la URL del webhook que debe usar tu despliegue.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4">
                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">URL base de Evolution Go</span>
                  <Input
                    name="apiBaseUrl"
                    type="url"
                    defaultValue={settings.apiBaseUrl}
                    placeholder="https://evolution.tudominio.com"
                    className="h-11"
                    required
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">Token global</span>
                  <Input
                    name="apiToken"
                    defaultValue={settings.apiToken}
                    placeholder="Tu GLOBAL_API_KEY de Evolution Go"
                    className="h-11"
                    required
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">Prefijo de instancias</span>
                  <Input
                    name="instancePrefix"
                    defaultValue={settings.instancePrefix}
                    placeholder="agente-lite"
                    className="h-11"
                    required
                  />
                  <p className="text-xs text-slate-500">
                    Se usa para generar nombres de instancia por cliente o agente.
                  </p>
                </label>

              </div>
            </div>

            <DialogFooter className="-mx-0 -mb-0 border-t-0 bg-transparent px-5 pt-0 pb-5">
              <Button type="button" variant="outline" onClick={() => setGoOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit">
                <Save className="h-4 w-4" />
                Guardar configuracion
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
