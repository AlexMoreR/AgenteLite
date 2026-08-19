"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Pause, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  borrarCampanaAction,
  iniciarCampanaAction,
  pausarCampanaAction,
} from "@/app/actions/campaign-actions";
import { NuevaCampanaDialog, type EtapaDelPublico } from "./NuevaCampanaDialog";

type CampanaItem = {
  id: string;
  name: string;
  crmStage: string | null;
  content: string;
  batchSize: number;
  intervalMinutes: number;
  status: "DRAFT" | "RUNNING" | "PAUSED" | "DONE";
  totalRecipients: number;
  sentCount: number;
  lastBatchAt: string | null;
  createdAt: string;
};

const ESTADO: Record<CampanaItem["status"], { texto: string; clase: string }> = {
  DRAFT: { texto: "Sin empezar", clase: "bg-muted text-muted-foreground" },
  RUNNING: {
    texto: "Enviando",
    clase: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  },
  PAUSED: {
    texto: "En pausa",
    clase: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  },
  DONE: {
    texto: "Terminada",
    clase: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  },
};

export function CampanasWorkspace({
  campanas,
  canales,
  etapas,
}: {
  campanas: CampanaItem[];
  canales: Array<{ id: string; name: string }>;
  etapas: EtapaDelPublico[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [ocupada, setOcupada] = useState<string | null>(null);

  const etiquetaDeEtapa = (stage: string | null) =>
    etapas.find((item) => item.value === stage)?.label ?? "Todos";

  const correr = async (id: string, accion: () => Promise<{ error?: string }>, exito: string) => {
    setOcupada(id);
    try {
      const resultado = await accion();
      if (resultado?.error) {
        toast.error(resultado.error);
        return;
      }
      toast.success(exito);
      router.refresh();
    } catch {
      toast.error("No se pudo. Recargá la página e intentá de nuevo.");
    } finally {
      setOcupada(null);
    }
  };

  /*
   * Ancho con techo: en escritorio las tarjetas se estiraban a 1500 px para mostrar un nombre y
   * una barra de avance, y el ojo tenia que cruzar la pantalla entera para leer un renglon.
   */
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      {/* Sin titulo ni bajada: el encabezado de la app ya dice "Campañas" y la pantalla
          vacia ya explica para que sirven. Queda solo el boton. */}
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={() => setAbierto(true)}>
          <Plus className="h-4 w-4" />
          Nueva campaña
        </Button>
      </div>

      {campanas.length === 0 ? (
        <Card>
          <CardContent className="mx-auto flex max-w-md flex-col items-center gap-2 py-12 text-center">
            <Megaphone className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-foreground">Todavía no hay campañas</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Una campaña se arma, se dispara y se termina. Para los mensajes que salen solos y
              para siempre están los Seguimientos.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {campanas.map((campana) => {
            const estado = ESTADO[campana.status];
            const avance =
              campana.totalRecipients > 0
                ? Math.round((campana.sentCount / campana.totalRecipients) * 100)
                : 0;
            return (
              <Card key={campana.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-sm">{campana.name}</CardTitle>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium leading-none ${estado.clase}`}
                    >
                      {estado.texto}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {etiquetaDeEtapa(campana.crmStage)} · {campana.batchSize} cada{" "}
                      {campana.intervalMinutes} min
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  <p className="line-clamp-2 text-xs text-muted-foreground">{campana.content}</p>

                  {campana.totalRecipients > 0 ? (
                    <div className="space-y-1">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${avance}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {campana.sentCount} de {campana.totalRecipients} enviados
                      </p>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    {campana.status === "DRAFT" || campana.status === "PAUSED" ? (
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        disabled={ocupada === campana.id}
                        onClick={() =>
                          void correr(
                            campana.id,
                            () => iniciarCampanaAction({ campaignId: campana.id }),
                            "Campaña andando",
                          )
                        }
                      >
                        <Play className="h-3.5 w-3.5" />
                        {campana.status === "PAUSED" ? "Reanudar" : "Iniciar"}
                      </Button>
                    ) : null}

                    {campana.status === "RUNNING" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        disabled={ocupada === campana.id}
                        onClick={() =>
                          void correr(
                            campana.id,
                            () => pausarCampanaAction({ campaignId: campana.id }),
                            "Campaña en pausa",
                          )
                        }
                      >
                        <Pause className="h-3.5 w-3.5" />
                        Pausar
                      </Button>
                    ) : null}

                    {campana.status === "DRAFT" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        disabled={ocupada === campana.id}
                        onClick={() =>
                          void correr(
                            campana.id,
                            () => borrarCampanaAction({ campaignId: campana.id }),
                            "Campaña borrada",
                          )
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Borrar
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/*
        Montado solo mientras esta abierto: si queda puesto y apagado, el fondo del modal puede
        quedarse en el DOM tapando la pantalla entera y comiendose los clicks (paso el 13-ago-2026
        con el modal de seguimientos del embudo).
      */}
      {abierto ? (
        <NuevaCampanaDialog
          abierto
          etapas={etapas}
          canales={canales}
          onCerrar={() => setAbierto(false)}
          onCreada={() => {
            setAbierto(false);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
