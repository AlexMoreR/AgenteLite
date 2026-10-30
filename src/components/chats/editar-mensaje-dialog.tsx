"use client";

import * as React from "react";

import type { SharedInboxMessageItem } from "@/components/chats/chat-inbox-types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
      <DialogContent className="max-h-[calc(var(--app-viewport-height,100dvh)-2rem)] overflow-y-auto sm:max-w-md max-sm:top-4 max-sm:translate-y-0">
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
      <Textarea
        autoFocus
        onFocus={(evento) => {
          // El cursor al final del texto, no al principio.
          const largo = evento.currentTarget.value.length;
          evento.currentTarget.setSelectionRange(largo, largo);
        }}
        value={texto}
        onChange={(evento) => setTexto(evento.target.value)}
        rows={5}
        maxLength={4096}
        aria-label="Texto del mensaje"
        className="resize-none"
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
