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

type EtapaEditable = { stage: string; goal: string; script: string };

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
}: {
  productId: string;
  stages: EtapaEditable[];
  /** El texto se trajo del embudo que el agente ya tenia y todavia no se guardo aca. */
  vienenDelAgente: boolean;
}) {
  const router = useRouter();
  const [etapas, setEtapas] = useState<EtapaEditable[]>(() =>
    PRODUCT_FUNNEL_STAGES.map((meta) => {
      const guardada = stages.find((etapa) => etapa.stage === meta.stage);
      return {
        stage: meta.stage,
        goal: guardada?.goal ?? "",
        script: guardada?.script ?? "",
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
        {vienenDelAgente ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Esto es lo que el agente ya venía usando. Guardalo para poder corregirlo sin republicar.
          </p>
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
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{meta.label}</span>
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
