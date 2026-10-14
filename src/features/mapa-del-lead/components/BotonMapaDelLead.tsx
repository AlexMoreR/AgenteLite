"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ExternalLink, LoaderCircle, Network, X } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { leerMapaDelLeadAction } from "@/app/actions/mapa-del-lead-actions";
import { cn } from "@/lib/utils";

import type { DatosDelLead } from "../dominio/mapa";

// El lienzo (React Flow) se baja solo al abrir el mapa: la bandeja no carga ni un byte de más.
const MapaDelLead = dynamic(() => import("./MapaDelLead"), {
  ssr: false,
  loading: () => <Cargando />,
});

function Cargando() {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" />
      Armando el mapa…
    </div>
  );
}

/**
 * "Mapa del lead" en la cabecera del chat: abre a pantalla completa la vista 360° del cliente
 * (conversaciones, etapas, bot, seguimientos, automatizaciones, tareas, llamadas). Es un diálogo
 * encima de la bandeja: al cerrarlo, la bandeja queda exactamente como estaba.
 */
export function BotonMapaDelLead({ chatKey, compacto = false }: { chatKey: string; compacto?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [datos, setDatos] = useState<DatosDelLead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const abrir = async () => {
    setAbierto(true);
    setCargando(true);
    setError(null);
    try {
      const r = await leerMapaDelLeadAction({ chatKey });
      if ("error" in r) {
        setError(r.error);
        setDatos(null);
      } else {
        setDatos(r.datos);
      }
    } catch {
      setError("No se pudo armar el mapa");
    } finally {
      setCargando(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void abrir()}
        aria-label="Mapa del lead"
        title="Mapa del lead"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-card transition hover:bg-muted",
          compacto ? "size-8" : "h-8 w-8",
        )}
      >
        <Network className="size-4 text-[#7c3aed]" />
      </button>

      <Dialog open={abierto} onOpenChange={(v) => setAbierto(v)}>
        <DialogContent
          showCloseButton={false}
          className="top-0 left-0 flex h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-none"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
            <Network className="size-4 text-[#7c3aed]" />
            <DialogTitle className="flex-1 truncate text-sm font-semibold">
              Mapa del lead{datos ? ` · ${datos.contacto.nombre?.trim() || `•••• ${datos.contacto.telefono4 ?? ""}`}` : ""}
            </DialogTitle>
            <Link
              href={`/cliente/mapa-del-lead?chatKey=${encodeURIComponent(chatKey)}`}
              target="_blank"
              className="hidden items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted sm:inline-flex"
            >
              <ExternalLink className="size-3.5" />
              Abrir aparte
            </Link>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              aria-label="Cerrar"
              className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"
            >
              <X className="size-4" />
            </button>
          </div>
          {cargando ? (
            <Cargando />
          ) : error ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">{error}</div>
          ) : datos ? (
            <MapaDelLead datos={datos} alAbrirChat={() => setAbierto(false)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
