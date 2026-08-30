"use client";

import * as React from "react";
import { Server } from "lucide-react";

import { cambiarProveedorDeCanalAction } from "@/app/actions/connection-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/**
 * Cambiar el servidor por el que sale un canal, desde la lista de conexiones.
 *
 * Lo que la gente teme perder al cambiar de servidor -conversaciones, mensajes, contactos, etapas,
 * etiquetas, seguimientos, el agente- NO vive ahi: cuelga del canal, en nuestra base. El servidor
 * es el cable por donde entran y salen los mensajes, nada mas.
 *
 * El item y el dialogo van SEPARADOS: si el <Dialog> vive dentro del menu, al cerrarse el menu se
 * desmonta y el dialogo nunca llega a abrirse. Mismo patron que "Renombrar".
 */

export const NOMBRE_DE_SERVIDOR: Record<string, string> = {
  EVOLUTION_GO: "Evolution GO",
  EVOLUTION_API: "Evolution API",
  WAHA: "WAHA",
};

export function ChannelProviderMenuItem({ onSelect }: { onSelect: () => void }) {
  return (
    <DropdownMenuItem
      className="w-full"
      // onClick y no onSelect: este menu es Base UI, y ahi onSelect se ignora en silencio.
      onClick={(event) => {
        event.preventDefault();
        onSelect();
      }}
    >
      <Server />
      Proveedor
    </DropdownMenuItem>
  );
}

export function ChannelProviderDialog({
  channelId,
  channelName,
  gatewayKind,
  gateways,
  open,
  onOpenChange,
}: {
  channelId: string;
  channelName: string;
  /** Por que servidor sale HOY. */
  gatewayKind: string;
  gateways: Array<{ id: string; kind: string; baseUrl: string }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [elegido, setElegido] = React.useState<string>("");

  // Los que NO son el actual: cambiar al mismo no hace nada y solo invita a un clic inutil.
  const opciones = gateways.filter((gateway) => gateway.kind !== gatewayKind);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Proveedor de {channelName}</DialogTitle>
          <DialogDescription>
            Hoy sale por <strong>{NOMBRE_DE_SERVIDOR[gatewayKind] ?? gatewayKind}</strong>. El
            número no cambia y no se pierde nada: las conversaciones, los contactos y el CRM cuelgan
            del canal, no del servidor.
          </DialogDescription>
        </DialogHeader>

        {opciones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay otro servidor configurado para mover este canal.
          </p>
        ) : (
          <form action={cambiarProveedorDeCanalAction} className="space-y-3">
            <input type="hidden" name="channelId" value={channelId} />

            <div className="space-y-2">
              {opciones.map((gateway) => (
                <label
                  key={gateway.id}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition ${
                    elegido === gateway.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                  }`}
                >
                  <input
                    type="radio"
                    name="gatewayId"
                    value={gateway.id}
                    checked={elegido === gateway.id}
                    onChange={() => setElegido(gateway.id)}
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      {NOMBRE_DE_SERVIDOR[gateway.kind] ?? gateway.kind}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {gateway.baseUrl.replace(/^https?:\/\//, "")}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {/*
              Las dos consecuencias, dichas ANTES de apretar.

              Son las dos cosas que sorprenden si uno se entera despues: que hay que volver a
              escanear, y que hasta desconectar el viejo los dos reciben todo -y se ven mensajes
              repetidos-.
            */}
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-500/40 dark:bg-amber-950 dark:text-amber-100">
              <p>Vas a tener que escanear el QR una vez.</p>
              <p className="mt-1">
                Después, desconectá el servidor viejo: mientras los dos estén activos sobre el mismo
                número, los dos reciben todo.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={!elegido}>
                Cambiar proveedor
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
