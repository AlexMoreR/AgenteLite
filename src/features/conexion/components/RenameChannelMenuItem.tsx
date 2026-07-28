"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { renameConnectionChannelAction } from "@/app/actions/connection-actions";
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
import { Input } from "@/components/ui/input";

// El item del menu y el dialogo van SEPARADOS a proposito: si el <Dialog> vive dentro del
// DropdownMenuContent, al cerrarse el menu se desmonta y el dialogo nunca llega a abrirse.
// El padre renderiza el item dentro del menu y el dialogo fuera, compartiendo el estado.

export function RenameChannelMenuItem({ onSelect }: { onSelect: () => void }) {
  return (
    <DropdownMenuItem
      className="w-full"
      onClick={(event) => {
        event.preventDefault();
        onSelect();
      }}
    >
      <Pencil />
      Renombrar
    </DropdownMenuItem>
  );
}

export function RenameChannelDialog({
  channelId,
  currentName,
  open,
  onOpenChange,
}: {
  channelId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Renombrar canal</DialogTitle>
          <DialogDescription>Cambia el nombre visible de esta conexion.</DialogDescription>
        </DialogHeader>

        <form action={renameConnectionChannelAction} className="grid gap-3">
          <input type="hidden" name="channelId" value={channelId} />
          <Input name="name" defaultValue={currentName} placeholder="Nombre del canal" required autoFocus />

          <DialogFooter>
            <Button type="submit">Guardar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
