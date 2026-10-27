"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { marcarAlertaAction } from "@/app/actions/alertas-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ETIQUETA_DE_ESTADO, ETIQUETA_DE_PRIORIDAD, type EstadoDeAlerta, type Prioridad } from "../dominio/reglas";

export type FilaDeAlerta = {
  id: string;
  prioridad: string;
  titulo: string;
  detalle: string | null;
  origen: string;
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

export function ListaDeAlertas({ alertas }: { alertas: FilaDeAlerta[] }) {
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

  if (alertas.length === 0) {
    return <p className="text-sm text-muted-foreground">No hay alertas con estos filtros.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {alertas.map((alerta) => (
        <Card key={alerta.id} size="sm" className={alerta.estado === "RESUELTA" ? "opacity-60" : undefined}>
          <CardContent className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={COLOR_PRIORIDAD[alerta.prioridad as Prioridad] ?? "outline"}>
                {ETIQUETA_DE_PRIORIDAD[alerta.prioridad as Prioridad] ?? alerta.prioridad}
              </Badge>
              <Badge variant="outline">{ETIQUETA_DE_ESTADO[alerta.estado as EstadoDeAlerta] ?? alerta.estado}</Badge>
              <span className="text-xs text-muted-foreground">
                {alerta.fecha} · {alerta.origen}
                {alerta.veces > 1 ? ` · se repitió ${alerta.veces} veces` : ""}
                {alerta.salioPorWhatsApp ? " · avisada por WhatsApp" : ""}
              </span>
            </div>
            <p className="text-sm font-medium">{alerta.titulo}</p>
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
