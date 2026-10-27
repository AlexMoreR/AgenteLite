"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { MAXIMO_TEXTO_EDITADO } from "@/lib/editar-mensaje";

/** Cuadro para cambiar el texto de un mensaje ya enviado. Guarda con `onGuardar(textoNuevo)`. */
export function EditMessageDialog({
  textoActual,
  onGuardar,
  onCerrar,
}: {
  /** null = cerrado. */
  textoActual: string | null;
  onGuardar: (texto: string) => void;
  onCerrar: () => void;
}) {
  return (
    <Dialog open={textoActual !== null} onOpenChange={(abierto) => (abierto ? undefined : onCerrar())}>
      <DialogContent className="sm:max-w-md">
        {/* Se monta al abrir: asi el texto de partida es siempre el del mensaje elegido. */}
        {textoActual !== null ? (
          <FormularioDeEdicion textoActual={textoActual} onGuardar={onGuardar} onCerrar={onCerrar} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FormularioDeEdicion({
  textoActual,
  onGuardar,
  onCerrar,
}: {
  textoActual: string;
  onGuardar: (texto: string) => void;
  onCerrar: () => void;
}) {
  const [texto, setTexto] = useState(textoActual);
  const limpio = texto.trim();
  const puedeGuardar = limpio.length > 0 && limpio !== textoActual.trim();

  return (
    <>
      <DialogHeader>
        <DialogTitle>Editar mensaje</DialogTitle>
      </DialogHeader>
      <Textarea
        value={texto}
        onChange={(evento) => setTexto(evento.target.value)}
        maxLength={MAXIMO_TEXTO_EDITADO}
        rows={5}
        autoFocus
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCerrar}>
          Cancelar
        </Button>
        <Button type="button" disabled={!puedeGuardar} onClick={() => onGuardar(limpio)}>
          Guardar
        </Button>
      </DialogFooter>
    </>
  );
}
