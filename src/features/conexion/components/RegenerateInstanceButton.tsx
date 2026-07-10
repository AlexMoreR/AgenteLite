"use client";

import { useState } from "react";
import { RefreshCcw } from "lucide-react";

import { regenerateConnectionInstanceAction } from "@/app/actions/connection-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function RegenerateInstanceButton({
  channelId,
  returnTo,
}: {
  channelId: string;
  returnTo: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RefreshCcw className="size-4" />
        Crear cuenta nueva
      </Button>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Crear cuenta nueva (sin perder datos)</DialogTitle>
          <DialogDescription>
            Se generará una conexión nueva con un QR nuevo para este canal. Tus chats, contactos,
            CRM, etiquetas y el agente vinculado se conservan; solo tendrás que volver a escanear el
            QR con tu WhatsApp. La conexión anterior se elimina.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <form action={regenerateConnectionInstanceAction}>
            <input type="hidden" name="channelId" value={channelId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit">
              <RefreshCcw className="size-4" />
              Crear cuenta nueva
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
