"use client";

import { useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  adminCreateEvolutionGatewayAction,
  adminDeleteEvolutionGatewayAction,
} from "@/app/actions/settings-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type GatewayRow = {
  id: string;
  kind: "EVOLUTION_GO" | "EVOLUTION_API";
  baseUrl: string;
  apiKey: string;
};

type WhatsAppConnectionsSettingsProps = {
  gateways: GatewayRow[];
  webhookUrl: string;
};

const KIND_LABEL: Record<GatewayRow["kind"], string> = {
  EVOLUTION_GO: "Evolution GO",
  EVOLUTION_API: "Evolution API",
};

// Enmascara la apikey: se muestra solo el inicio para poder identificarla sin exponerla.
function maskApiKey(apiKey: string) {
  const trimmed = apiKey.trim();
  if (!trimmed) return "—";
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 6)}••••••••`;
}

export function WhatsAppConnectionsSettings({ gateways, webhookUrl }: WhatsAppConnectionsSettingsProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [kind, setKind] = useState<GatewayRow["kind"]>("EVOLUTION_GO");

  return (
    <>
      <div className="flex items-center justify-end">
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Nueva conexion
        </Button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--line)] bg-white">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Tipo</th>
              <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">URL base</th>
              <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Apikey</th>
              <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Webhook</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {gateways.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                  No hay conexiones configuradas. Agrega una con &quot;Nueva conexion&quot;.
                </td>
              </tr>
            ) : (
              gateways.map((gateway) => (
                <tr key={gateway.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <Badge variant={gateway.kind === "EVOLUTION_GO" ? "default" : "outline"}>
                      {KIND_LABEL[gateway.kind]}
                    </Badge>
                  </td>
                  <td className="max-w-[16rem] truncate px-4 py-3 font-medium text-slate-900" title={gateway.baseUrl}>
                    {gateway.baseUrl}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{maskApiKey(gateway.apiKey)}</td>
                  <td className="max-w-[18rem] truncate px-4 py-3 text-slate-600" title={webhookUrl}>
                    {webhookUrl || "No configurado por entorno"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <form action={adminDeleteEvolutionGatewayAction} className="inline">
                      <input type="hidden" name="id" value={gateway.id} />
                      <Button type="submit" variant="ghost" size="sm" aria-label="Eliminar conexion">
                        <Trash2 className="h-4 w-4 text-slate-500" />
                      </Button>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="w-[min(94vw,40rem)] max-w-none border border-border bg-popover p-0 shadow-[0_30px_80px_-36px_rgba(15,23,42,0.45)]">
          <form action={adminCreateEvolutionGatewayAction} className="space-y-0">
            <input type="hidden" name="kind" value={kind} />

            <div className="space-y-5 p-5">
              <DialogHeader className="text-left">
                <DialogTitle>Nueva conexion</DialogTitle>
                <DialogDescription>
                  Elige el servidor y sus credenciales. Los canales podran usar esta conexion.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-1.5">
                <span className="text-sm font-medium text-slate-700">Tipo de servidor</span>
                <div className="grid grid-cols-2 gap-2">
                  {(["EVOLUTION_GO", "EVOLUTION_API"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setKind(option)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                        kind === option
                          ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-slate-900 ring-1 ring-[var(--primary)]"
                          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                      )}
                    >
                      {KIND_LABEL[option]}
                      <span className="mt-0.5 block text-xs font-normal text-slate-500">
                        {option === "EVOLUTION_GO" ? "Realtime" : "Historial + rellenado"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">URL base</span>
                <Input
                  name="baseUrl"
                  type="url"
                  placeholder={kind === "EVOLUTION_GO" ? "https://evogo-1.tudominio.com" : "https://evo-api.tudominio.com"}
                  className="h-11"
                  required
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">Apikey global</span>
                <Input name="apiKey" placeholder="GLOBAL_API_KEY del servidor" className="h-11" />
              </label>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Webhook</p>
                <p className="mt-1 break-all text-xs text-slate-600">
                  {webhookUrl || "No configurado por entorno"}
                </p>
              </div>
            </div>

            <DialogFooter className="-mx-0 -mb-0 border-t-0 bg-transparent px-5 pt-0 pb-5">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit">
                <Save className="h-4 w-4" />
                Guardar conexion
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
