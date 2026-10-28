"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { marcarAlertaAction } from "@/app/actions/alertas-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ETIQUETA_DE_ESTADO, ETIQUETA_DE_PRIORIDAD, leerAreaDeAlerta, type EstadoDeAlerta, type Prioridad } from "../dominio/reglas";

export type FilaDeAlerta = {
  id: string;
  /** Es la que abrió el link directo (?alerta=<id>). */
  resaltada?: boolean;
  prioridad: string;
  titulo: string;
  detalle: string | null;
  origen: string;
  /** Área de la alerta (lista fija de reglas.ts). */
  area: string;
  /** Si viene de una tarjeta del tablero, su id (para abrirla). */
  tarjetaId: string | null;
  estado: string;
  veces: number;
  salioPorWhatsApp: boolean;
  /** Ya formateada (hora de Bogotá) en el servidor. */
  fecha: string;
};

const COLOR_PRIORIDAD: Record<Prioridad, "destructive" | "default" | "secondary" | "outline"> = {
  URGENTE: "destructive",
  ALTA: "default",
  MEDIA: "secondary",
  BAJA: "outline",
};

const CLAVE_DEL_FILTRO = "alertas:filtro-de-area";

export function ListaDeAlertas({ alertas, areas, conteoPorArea }: { alertas: FilaDeAlerta[]; areas: string[]; conteoPorArea: Record<string, number> }) {
  // null = "Todas". El filtro recordado se lee al montar; si ya no existe o el navegador no deja leer, queda "Todas".
  const [filtro, setFiltro] = useState<string | null>(null);
  useEffect(() => {
    try {
      const guardado = leerAreaDeAlerta(window.localStorage.getItem(CLAVE_DEL_FILTRO));
      if (guardado && areas.includes(guardado)) setFiltro(guardado);
    } catch {
      // sin almacenamiento: se muestra "Todas"
    }
  }, [areas]);
  const elegir = (area: string | null) => {
    setFiltro(area);
    try {
      if (area) window.localStorage.setItem(CLAVE_DEL_FILTRO, area);
      else window.localStorage.removeItem(CLAVE_DEL_FILTRO);
    } catch {
      // no se pudo recordar: el filtro igual se aplica
    }
  };
  const totalAbiertas = areas.reduce((suma, area) => suma + (conteoPorArea[area] ?? 0), 0);
  const visibles = filtro ? alertas.filter((alerta) => alerta.area === filtro) : alertas;

  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const marcar = (id: string, nuevo: "VISTA" | "RESUELTA") => {
    setError(null);
    empezar(async () => {
      const resultado = await marcarAlertaAction(id, nuevo);
      if (!resultado.ok) setError(resultado.error);
      router.refresh();
    });
  };

  const botonDeArea = (activo: boolean) =>
    cn(
      "inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium",
      activo ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por área">
        <button type="button" className={botonDeArea(filtro === null)} onClick={() => elegir(null)}>
          Todas <span className="text-xs opacity-80">{totalAbiertas} abiertas</span>
        </button>
        {areas.map((area) => (
          <button key={area} type="button" className={botonDeArea(filtro === area)} onClick={() => elegir(area)}>
            {area} <span className="text-xs opacity-80">{conteoPorArea[area] ?? 0} abiertas</span>
          </button>
        ))}
      </div>
      {visibles.length === 0 ? <p className="text-sm text-muted-foreground">No hay alertas con estos filtros.</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {visibles.map((alerta) => (
        <Card key={alerta.id} size="sm" className={cn(alerta.estado === "RESUELTA" && "opacity-60", alerta.resaltada && "ring-2 ring-primary")}>
          <CardContent className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={COLOR_PRIORIDAD[alerta.prioridad as Prioridad] ?? "outline"}>
                {ETIQUETA_DE_PRIORIDAD[alerta.prioridad as Prioridad] ?? alerta.prioridad}
              </Badge>
              <Badge variant="secondary">{alerta.area}</Badge>
              <Badge variant="outline">{ETIQUETA_DE_ESTADO[alerta.estado as EstadoDeAlerta] ?? alerta.estado}</Badge>
              <span className="text-xs text-muted-foreground">
                {alerta.fecha} · {alerta.origen}
                {alerta.veces > 1 ? ` · se repitió ${alerta.veces} veces` : ""}
                {alerta.salioPorWhatsApp ? " · avisada por WhatsApp" : ""}
              </span>
            </div>
            {alerta.tarjetaId ? (
              <Link href={`/cliente/tablero-ia?tarjeta=${encodeURIComponent(alerta.tarjetaId)}`} className="text-sm font-medium underline-offset-2 hover:underline">
                {alerta.titulo} →
              </Link>
            ) : (
              <p className="text-sm font-medium">{alerta.titulo}</p>
            )}
            {alerta.detalle ? <p className="whitespace-pre-line text-sm text-muted-foreground">{alerta.detalle}</p> : null}
            {alerta.estado !== "RESUELTA" ? (
              <div className="flex gap-2">
                {alerta.estado === "NUEVA" ? (
                  <Button size="sm" variant="outline" disabled={pendiente} onClick={() => marcar(alerta.id, "VISTA")}>
                    Marcar vista
                  </Button>
                ) : null}
                <Button size="sm" disabled={pendiente} onClick={() => marcar(alerta.id, "RESUELTA")}>
                  Marcar resuelta
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
