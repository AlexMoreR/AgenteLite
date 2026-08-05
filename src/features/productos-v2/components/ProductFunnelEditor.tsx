"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveProductFunnelAction } from "@/app/actions/product-playbook-actions";
import { PRODUCT_FUNNEL_STAGES } from "@/lib/product-funnel-stages";

type EtapaEditable = { stage: string; goal: string; script: string; stuckAfterMessages: number | null };

/**
 * El embudo de ventas del producto, en sus cinco etapas.
 *
 * Plegado y de a una: las cinco etapas abiertas eran diez campos juntos, y una pantalla asi no se
 * llena —se cierra. Cerradas, cada etapa muestra en una linea lo que ya dice, asi el embudo se
 * puede LEER de un vistazo, que es como se revisa una venta.
 *
 * Son las mismas etapas con las que ya trabaja el motor, pero editables desde aca y aplicadas al
 * responder: antes vivian dentro del diagrama del agente y habia que republicar.
 */
export function ProductFunnelEditor({
  productId,
  stages,
  vienenDelAgente,
  avance,
}: {
  productId: string;
  stages: EtapaEditable[];
  /** El texto se trajo del embudo que el agente ya tenia y todavia no se guardo aca. */
  vienenDelAgente: boolean;
  /** Hasta donde llegaron los leads en los ultimos 30 dias. */
  avance: {
    murioPrimero: number;
    mandoDos: number;
    converso: number;
    larga: number;
    total: number;
  } | null;
}) {
  const router = useRouter();
  const [etapas, setEtapas] = useState<EtapaEditable[]>(() =>
    PRODUCT_FUNNEL_STAGES.map((meta) => {
      const guardada = stages.find((etapa) => etapa.stage === meta.stage);
      return {
        stage: meta.stage,
        goal: guardada?.goal ?? "",
        script: guardada?.script ?? "",
        stuckAfterMessages: guardada?.stuckAfterMessages ?? null,
      };
    }),
  );
  const [guardado, setGuardado] = useState(() => JSON.stringify(etapas));
  const [ocupado, setOcupado] = useState(false);

  const hayCambios = JSON.stringify(etapas) !== guardado;
  const escritas = etapas.filter((etapa) => etapa.goal || etapa.script).length;

  // Se abre en la primera etapa que falta: es la que hay que trabajar.
  const [abierta] = useState<string[]>(() => {
    const pendiente = PRODUCT_FUNNEL_STAGES.find((meta) => {
      const etapa = stages.find((item) => item.stage === meta.stage);
      return !etapa?.goal && !etapa?.script;
    });
    return [pendiente?.stage ?? PRODUCT_FUNNEL_STAGES[0].stage];
  });

  const actualizar = (stage: string, campo: "goal" | "script", valor: string) => {
    setEtapas((actual) =>
      actual.map((etapa) => (etapa.stage === stage ? { ...etapa, [campo]: valor } : etapa)),
    );
  };

  const actualizarLimite = (stage: string, valor: string) => {
    const numero = Number.parseInt(valor, 10);
    setEtapas((actual) =>
      actual.map((etapa) =>
        etapa.stage === stage
          ? { ...etapa, stuckAfterMessages: Number.isFinite(numero) && numero > 0 ? numero : null }
          : etapa,
      ),
    );
  };

  const guardar = async () => {
    setOcupado(true);
    try {
      const result = await saveProductFunnelAction({ productId, stages: etapas });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setGuardado(JSON.stringify(etapas));
      toast.success("Embudo guardado");
      router.refresh();
    } catch {
      toast.error("No se pudo guardar. Recargá la página e intentá de nuevo.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">Embudo de ventas</CardTitle>
          <span className="text-xs text-muted-foreground">{escritas} de 5 escritas</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/*
          Hasta donde llegan los leads, contando mensajes. Antes aca habia un conteo por etapa
          comercial: medido contra la base, 920 de 924 conversaciones caian en la MISMA etapa
          —el clasificador va por listas de palabras y las de "diagnostico" las pescan a todas—,
          asi que el numero era casi constante y no decia nada. Esto es mas tosco y es cierto.
        */}
        {avance && avance.total > 0 ? (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-xs font-medium text-foreground">
              Hasta dónde llegan · últimos 30 días{" "}
              <span className="font-normal text-muted-foreground">({avance.total} leads)</span>
            </p>
            {[
              { etiqueta: "Se fue en el 1er mensaje", valor: avance.murioPrimero, malo: true },
              { etiqueta: "Mandó 2 mensajes", valor: avance.mandoDos, malo: true },
              { etiqueta: "Conversó (3 a 5)", valor: avance.converso, malo: false },
              { etiqueta: "Conversación larga (6+)", valor: avance.larga, malo: false },
            ].map((fila) => {
              const pct = Math.round((fila.valor / avance.total) * 100);
              return (
                <div key={fila.etiqueta} className="flex items-center gap-2 text-xs">
                  <span className="w-36 shrink-0 text-muted-foreground sm:w-44">{fila.etiqueta}</span>
                  <span className="hidden h-2 flex-1 overflow-hidden rounded-full bg-muted sm:block">
                    <span
                      className={`block h-full rounded-full ${fila.malo ? "bg-amber-500" : "bg-emerald-500"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="ml-auto w-20 shrink-0 text-right tabular-nums text-foreground sm:ml-0">
                    {fila.valor} · {pct}%
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        <Accordion defaultValue={abierta} keepMounted>
          {PRODUCT_FUNNEL_STAGES.map((meta, indice) => {
            const etapa = etapas.find((item) => item.stage === meta.stage);
            const resumen = etapa?.goal || etapa?.script || "";
            return (
              <AccordionItem key={meta.stage} value={meta.stage}>
                <AccordionTrigger className="py-3 hover:no-underline">
                  <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <span
                      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${
                        resumen
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {indice + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{meta.label}</span>
                      </span>
                      <span
                        className={`block truncate text-xs ${
                          resumen ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {resumen || "sin escribir"}
                      </span>
                    </span>
                  </span>
                </AccordionTrigger>

                <AccordionContent className="pb-4">
                  <div className="space-y-2">
                    <Label className="text-xs">Qué hay que lograr</Label>
                    <Input
                      value={etapa?.goal ?? ""}
                      onChange={(event) => actualizar(meta.stage, "goal", event.target.value)}
                      placeholder={meta.ayuda}
                    />
                    <Label className="text-xs">Qué decir</Label>
                    <Textarea
                      rows={3}
                      value={etapa?.script ?? ""}
                      onChange={(event) => actualizar(meta.stage, "script", event.target.value)}
                      placeholder="El mensaje, como se lo dirías vos…"
                    />

                    {/* La red de seguridad: el limite que se cumple decida lo que decida la IA. */}
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                      <span>Si lleva</span>
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        className="h-8 w-16"
                        value={etapa?.stuckAfterMessages ?? ""}
                        onChange={(event) => actualizarLimite(meta.stage, event.target.value)}
                        placeholder="—"
                      />
                      <span>mensajes acá sin avanzar, avisar a un asesor.</span>
                      {etapa?.stuckAfterMessages ? null : <span>Vacío: sin aviso.</span>}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        <div className="flex items-center gap-3">
          <Button type="button" size="sm" onClick={() => void guardar()} disabled={ocupado}>
            Guardar embudo
          </Button>
          {hayCambios || vienenDelAgente ? (
            <span className="text-xs text-amber-700 dark:text-amber-300">Sin guardar</span>
          ) : escritas > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              Guardado
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
