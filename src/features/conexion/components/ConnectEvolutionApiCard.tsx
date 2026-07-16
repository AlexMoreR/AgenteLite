"use client";

import { useState } from "react";
import { Plug, Loader2 } from "lucide-react";
import { connectEvolutionApiToChannelAction } from "@/app/actions/connection-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Conexiones Evolution API del catalogo (Admin > Configuracion WhatsApp). Sin apikey:
// el servidor la resuelve por id.
type ApiGatewayOption = {
  id: string;
  baseUrl: string;
};

type ConnectEvolutionApiCardProps = {
  channelId: string;
  gateways: ApiGatewayOption[];
};

// Conecta ESTE canal a Evolution API (reemplaza a evogo en el canal). Provisiona una
// instancia nueva en el servidor elegido y pide un QR nuevo para vincular. Conserva las
// conversaciones/contactos del canal (cuelgan del channelId).
export function ConnectEvolutionApiCard({ channelId, gateways }: ConnectEvolutionApiCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedGatewayId, setSelectedGatewayId] = useState(gateways[0]?.id ?? "");

  return (
    <Card>
      <CardContent className="space-y-3">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
          <Plug className="size-4 text-primary" />
          <span>Conectar Evolution API</span>
        </p>

        {expanded ? (
          <form
            action={connectEvolutionApiToChannelAction}
            className="space-y-3"
            onSubmit={() => setIsSubmitting(true)}
          >
            <input type="hidden" name="channelId" value={channelId} />
            <input type="hidden" name="gatewayId" value={selectedGatewayId} />

            <p className="rounded-lg border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
              Esto apunta este canal a <strong>Evolution API</strong> (reemplaza a Evolution GO en este
              canal). Se generara un <strong>QR nuevo</strong> para vincular tu WhatsApp. Tus
              conversaciones y contactos se conservan.
            </p>

            {gateways.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center">
                <p className="text-sm font-medium text-foreground">Falta configurar por un administrador</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  No hay ninguna conexion de Evolution API configurada todavia.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Servidor de Evolution API</Label>
                <div className="grid gap-2">
                  {gateways.map((gateway) => (
                    <button
                      key={gateway.id}
                      type="button"
                      onClick={() => setSelectedGatewayId(gateway.id)}
                      disabled={isSubmitting}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left transition-colors",
                        selectedGatewayId === gateway.id
                          ? "border-primary bg-primary/10 ring-1 ring-primary"
                          : "border-border bg-card hover:bg-muted/50",
                      )}
                    >
                      <span className="block truncate text-sm text-foreground">{gateway.baseUrl}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={isSubmitting || gateways.length === 0 || !selectedGatewayId}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Conectar y generar QR
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setExpanded(false)}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="outline" className="w-full" onClick={() => setExpanded(true)}>
            Conectar este canal a Evolution API
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
