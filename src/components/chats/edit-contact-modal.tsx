"use client";

import { useEffect, useActionState } from "react";
import { updateContactAction } from "@/app/actions/chats-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  open: boolean;
  onClose: () => void;
  contactId: string;
  contactName: string;
};

type EditContactActionState =
  | { error: string; success?: false }
  | { success: true; contactId: string; name: string };

const initialState: EditContactActionState = { error: "" };

export function EditContactModal({ open, onClose, contactId, contactName }: Props) {
  const [state, formAction, isPending] = useActionState(updateContactAction, initialState);

  useEffect(() => {
    if (state.success && state.contactId) {
      window.dispatchEvent(
        new CustomEvent("chat-contact-updated", {
          detail: {
            contactId: state.contactId,
            name: state.name,
          },
        }),
      );
      onClose();
    }
  }, [state, onClose]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar contacto</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="contactId" value={contactId} />
          <div className="space-y-2">
            <Label htmlFor="edit-contact-name">Nombre</Label>
            <Input
              id="edit-contact-name"
              key={contactId}
              name="name"
              defaultValue={contactName}
              placeholder="Nombre del contacto"
              autoFocus
            />
          </div>
          {"error" in state && state.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
