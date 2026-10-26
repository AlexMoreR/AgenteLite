"use client";

import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { leerOrigenDelContactoAction } from "@/app/actions/origen-del-contacto-actions";
import type { OrigenDelCliente } from "@/lib/origen-del-cliente";

/**
 * Línea "Origen" de la ficha del chat: de dónde llegó el cliente. Solo lectura. Si la lectura falla
 * no muestra nada: nunca estorba al resto de la ficha.
 */
export function OrigenDelClienteLinea({ contactId }: { contactId: string | null | undefined }) {
  const [resultado, setResultado] = useState<{ contactId: string; origen: OrigenDelCliente } | null>(null);

  useEffect(() => {
    if (!contactId) return;
    let cancelado = false;
    leerOrigenDelContactoAction({ contactId })
      .then((respuesta) => {
        if (!cancelado && "origen" in respuesta) setResultado({ contactId, origen: respuesta.origen });
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [contactId]);

  // Al cambiar de chat no se muestra el origen del anterior mientras llega el nuevo.
  const origen = resultado && resultado.contactId === contactId ? resultado.origen : null;
  if (!origen) return null;

  return (
    <p className="flex items-center gap-1 text-xs text-muted-foreground" title="Origen del cliente">
      <Megaphone className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{origen.etiqueta}</span>
      {origen.adUrl ? (
        <a
          href={origen.adUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 underline hover:text-foreground"
        >
          Ver anuncio
        </a>
      ) : null}
    </p>
  );
}
