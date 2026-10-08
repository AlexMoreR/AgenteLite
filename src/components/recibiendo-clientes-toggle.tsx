"use client";

import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  guardarEstadoEnLineaCliente,
  leerEstadoEnLineaCliente,
  suscribirEstadoEnLinea,
  type EstadoEnLineaCliente,
} from "@/components/en-linea-store";
import { cn } from "@/lib/utils";

/**
 * "🟢 Recibiendo clientes" / "⚪ Pausada", en la barra superior (celular y PC).
 *
 * Con la app abierta la asesora recibe clientes nuevos sola; esto es para pausarse a mano
 * (almuerzo) y volver. El estado lo trae el latido de la app: este botón no pregunta nada por su
 * cuenta, solo escribe cuando ella lo toca. Ver src/lib/en-linea-reglas.ts.
 */
export function RecibiendoClientesToggle() {
  const estado = useSyncExternalStore(suscribirEstadoEnLinea, leerEstadoEnLineaCliente, () => null);
  const [guardando, setGuardando] = useState(false);

  if (!estado) {
    return null;
  }

  const cambiar = async () => {
    const quiere = !estado.recibiendo;
    setGuardando(true);
    try {
      const respuesta = await fetch("/api/cliente/en-linea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recibiendo: quiere }),
        cache: "no-store",
      });
      const datos = (await respuesta.json().catch(() => null)) as { enLinea?: EstadoEnLineaCliente } | null;
      if (!respuesta.ok || !datos?.enLinea) {
        throw new Error("sin respuesta");
      }
      guardarEstadoEnLineaCliente(datos.enLinea);
      toast.success(
        datos.enLinea.recibiendo
          ? "Estás recibiendo clientes nuevos."
          : "Pausada: no te llegan clientes nuevos. Tus chats siguen igual.",
      );
    } catch {
      toast.error("No se pudo cambiar. Intenta de nuevo.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={guardando}
      onClick={cambiar}
      aria-pressed={estado.recibiendo}
      title={
        estado.recibiendo
          ? "Te llegan clientes nuevos. Toca para pausarte."
          : "No te llegan clientes nuevos. Toca para recibir."
      }
      className={cn("px-2 text-xs", estado.recibiendo ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}
    >
      <span aria-hidden="true">{estado.recibiendo ? "🟢" : "⚪"}</span>
      {estado.recibiendo ? (
        <>
          <span className="sm:hidden">Recibiendo</span>
          <span className="hidden sm:inline">Recibiendo clientes</span>
        </>
      ) : (
        <span>Pausada</span>
      )}
    </Button>
  );
}
