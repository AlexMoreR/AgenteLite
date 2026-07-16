"use client";

import { useState } from "react";
import { Plug, Loader2 } from "lucide-react";
import { connectEvolutionApiToChannelAction } from "@/app/actions/connection-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ConnectEvolutionApiCardProps = {
  channelId: string;
};

// Conecta ESTE canal a Evolution API (reemplaza a evogo en el canal). Provisiona una
// instancia nueva en el servidor de Evolution API y pide un QR nuevo para vincular.
// Conserva las conversaciones/contactos del canal (cuelgan del channelId).
export function ConnectEvolutionApiCard({ channelId }: ConnectEvolutionApiCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

            <p className="rounded-lg border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
              Esto apunta este canal a tu servidor de <strong>Evolution API</strong> (reemplaza a
              Evolution GO en este canal). Se generara un <strong>QR nuevo</strong> para vincular tu
              WhatsApp. Tus conversaciones y contactos se conservan.
            </p>

            <div className="space-y-2">
              <Label htmlFor="connect-evo-api-url">URL base de Evolution API</Label>
              <Input
                id="connect-evo-api-url"
                name="baseUrl"
                type="url"
                required
                disabled={isSubmitting}
                placeholder="https://evo-api.tudominio.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="connect-evo-api-key">Apikey global (opcional)</Label>
              <Input
                id="connect-evo-api-key"
                name="apiKey"
                type="text"
                disabled={isSubmitting}
                placeholder="Apikey del servidor de Evolution API"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={isSubmitting}>
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
