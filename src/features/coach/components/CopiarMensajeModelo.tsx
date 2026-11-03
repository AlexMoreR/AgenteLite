"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

/** "Copiar mensaje modelo": lo deja en el portapapeles para pegarlo en el chat. */
export function CopiarMensajeModelo({ texto }: { texto: string }) {
  const [estado, setEstado] = useState<"listo" | "copiado" | "error">("listo");

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setEstado("copiado");
    } catch {
      setEstado("error");
    }
    window.setTimeout(() => setEstado("listo"), 2500);
  };

  return (
    <Button type="button" variant="outline" className="h-11 w-full sm:w-auto" onClick={copiar} aria-live="polite">
      {estado === "copiado" ? "Copiado ✓" : estado === "error" ? "No se pudo copiar" : "Copiar mensaje modelo"}
    </Button>
  );
}
