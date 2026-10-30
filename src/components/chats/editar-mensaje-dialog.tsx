"use client";

import * as React from "react";

import type { SharedInboxMessageItem } from "@/components/chats/chat-inbox-types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Cuadro para editar un mensaje de texto ya enviado (hasta 15 minutos despues).
 *
 * Solo recoge el texto nuevo: quien lo abre decide que hacer al guardar (cambio optimista, llamada
 * al servidor y aviso si WhatsApp no lo permite).
 */
export function EditarMensajeDialog({
  mensaje,
  alCerrar,
  alGuardar,
}: {
  mensaje: SharedInboxMessageItem | null;
  alCerrar: () => void;
  alGuardar: (mensaje: SharedInboxMessageItem, texto: string) => void;
}) {
  return (
    <Dialog open={Boolean(mensaje)} onOpenChange={(abierto) => (abierto ? undefined : alCerrar())}>
      <DialogContent className="max-w-md">
        {mensaje ? <Contenido key={mensaje.id} mensaje={mensaje} alCerrar={alCerrar} alGuardar={alGuardar} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Contenido({
  mensaje,
  alCerrar,
  alGuardar,
}: {
  mensaje: SharedInboxMessageItem;
  alCerrar: () => void;
  alGuardar: (mensaje: SharedInboxMessageItem, texto: string) => void;
}) {
  const [texto, setTexto] = React.useState(mensaje.content ?? "");
  const nuevo = texto.trim();
  const puedeGuardar = nuevo.length > 0 && nuevo !== (mensaje.content ?? "").trim();

  return (
    <form
      className="space-y-4"
      onSubmit={(evento) => {
        evento.preventDefault();
        if (puedeGuardar) {
          alGuardar(mensaje, nuevo);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Editar mensaje</DialogTitle>
      </DialogHeader>
      <textarea
        autoFocus
        value={texto}
        onChange={(evento) => setTexto(evento.target.value)}
        rows={5}
        maxLength={4096}
        aria-label="Texto del mensaje"
        className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <p className="text-xs text-muted-foreground">
        El cliente verá el texto nuevo con la marca &quot;Editado&quot; en su WhatsApp.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={alCerrar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!puedeGuardar}>
          Guardar
        </Button>
      </div>
    </form>
  );
}
