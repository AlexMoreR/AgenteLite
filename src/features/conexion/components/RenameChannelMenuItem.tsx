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

export function RenameChannelMenuItem({ channelId, currentName }: { channelId: string; currentName: string }) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <DropdownMenuItem
        className="w-full"
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        <Pencil />
        Renombrar
      </DropdownMenuItem>

      <Dialog open={open} onOpenChange={setOpen}>
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
    </>
  );
}
