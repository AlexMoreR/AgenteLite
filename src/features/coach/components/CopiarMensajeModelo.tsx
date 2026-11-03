"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/** "Copiar mensaje modelo": copia el texto al portapapeles para pegarlo en el chat. */
export function CopiarMensajeModelo({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      toast.success("Mensaje copiado");
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("No se pudo copiar. Mantén presionado el texto para copiarlo.");
    }
  }

  return (
    <Button type="button" variant="outline" className="h-11 w-full sm:w-auto" onClick={copiar} data-testid="copiar-mensaje-modelo">
      {copiado ? "Copiado" : "Copiar mensaje modelo"}
    </Button>
  );
}
