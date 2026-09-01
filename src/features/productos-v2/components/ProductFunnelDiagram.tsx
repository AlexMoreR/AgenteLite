"use client";

import { Bell } from "lucide-react";

import { PRODUCT_FUNNEL_STAGES } from "@/lib/product-funnel-stages";
import type { SeguimientoDeEtapa } from "./StageFollowUpDialog";

const UNIDAD_CORTA: Record<SeguimientoDeEtapa["timeType"], string> = {
  MINUTES: "min",
  HOURS: "h",
  DAYS: "d",
};

export type EtapaDelDiagrama = {
  stage: string;
  goal: string;
  script: string;
  followUps: SeguimientoDeEtapa[];
};

/**
 * El embudo dibujado, para mirarlo de corrido.
 *
 * La lista de arriba es donde se edita; esto es para VERLO. Cada paso muestra el mensaje como una
 * burbuja de WhatsApp, que es la forma en que le va a llegar al cliente: leer el guion escrito
 * como un parrafo de configuracion y leerlo como un mensaje no son la misma lectura, y el equipo
 * se enredaba con la primera.
 *
 * Va como una columna y no como un lienzo con cajas arrastrables: el embudo son cinco pasos en
 * linea recta, sin bifurcaciones, y en un celular arrastrar cajas es peor que desplazarse. Lo que
 * hacia falta era ver el recorrido completo con lo que se dice en cada paso, y eso es esto.
 */
export function ProductFunnelDiagram({
  etapas,
  perdidosEnEtapa,
}: {
  etapas: EtapaDelDiagrama[];
  perdidosEnEtapa: Record<string, { valor: number; pct: number } | undefined>;
}) {
  return (
    <div className="space-y-0">
      {PRODUCT_FUNNEL_STAGES.map((meta, indice) => {
        const etapa = etapas.find((item) => item.stage === meta.stage);
        const guion = etapa?.script?.trim() ?? "";
        const objetivo = etapa?.goal?.trim() ?? "";
        const perdidos = perdidosEnEtapa[meta.stage];
        const seguimientos = etapa?.followUps ?? [];

        return (
          <div key={meta.stage}>
            <div className="flex gap-3">
              {/* La columna del numero, con la linea que une un paso con el siguiente. */}
              <div className="flex flex-col items-center">
                <span
                  className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
                    guion || objetivo
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {indice + 1}
                </span>
                {indice < PRODUCT_FUNNEL_STAGES.length - 1 ? (
                  <span className="my-1 w-px flex-1 bg-border" aria-hidden="true" />
                ) : null}
              </div>

              <div className="min-w-0 flex-1 pb-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{meta.label}</span>

                  {/*
                    Cuantos se fueron sin pasar de aca. Es el dato que convierte el dibujo en algo
                    util: sin el, es el guion bonito; con el, se ve DONDE se corta la venta.
                  */}
                  {perdidos ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium leading-none text-amber-700 tabular-nums dark:bg-amber-950 dark:text-amber-300">
                      se caen {perdidos.valor} · {perdidos.pct}%
                    </span>
                  ) : null}

                  {seguimientos.length > 0 ? (
                    <span
                      title={`Si no contesta: ${seguimientos
                        .map((item) => `${item.timeValue} ${UNIDAD_CORTA[item.timeType]}`)
                        .join(" · ")}`}
                      className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium leading-none text-sky-700 tabular-nums dark:bg-sky-950 dark:text-sky-300"
                    >
                      <Bell className="h-3 w-3" />
                      {seguimientos.length}
                    </span>
                  ) : null}
                </div>

                {objetivo ? (
                  <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{objetivo}</p>
                ) : null}

                {/*
                  El guion, como burbuja.

                  Es el mismo texto que ya estaba en la lista; lo que cambia es que aca se lee como
                  lo va a leer el cliente. Se respetan los saltos de linea porque en WhatsApp
                  separan parrafos y en un parrafo corrido se perdian.
                */}
                {guion ? (
                  <div className="mt-2 max-w-[520px] rounded-2xl rounded-tl-sm border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/40">
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground">
                      {guion}
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-[12px] italic text-muted-foreground">
                    Sin mensaje. La IA improvisa este paso.
                  </p>
                )}

                {seguimientos.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {seguimientos.map((item, posicion) => (
                      <span
                        key={`${meta.stage}-${posicion}`}
                        className="rounded-full border border-border px-2 py-0.5 text-[11px] leading-none text-muted-foreground"
                      >
                        si no contesta · {item.timeValue} {UNIDAD_CORTA[item.timeType]}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
