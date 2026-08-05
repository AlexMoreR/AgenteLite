"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";

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
 * Son las mismas con las que ya trabaja el motor, pero editables desde aca y aplicadas al
 * responder: antes vivian dentro del diagrama del agente y habia que republicar para que un
 * cambio tuviera efecto.
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
        <CardTitle className="text-sm">Embudo de ventas</CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        {vienenDelAgente ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Esto es lo que el agente ya venía usando. Guardalo para que quede del producto y puedas
            corregirlo sin republicar.
          </p>
        ) : null}

        {PRODUCT_FUNNEL_STAGES.map((meta, indice) => {
          const etapa = etapas.find((item) => item.stage === meta.stage);
          return (
            <div key={meta.stage} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
                  {indice + 1}
                </span>
                <Label className="text-sm">{meta.label}</Label>
              </div>

              <Input
                value={etapa?.goal ?? ""}
                onChange={(event) => actualizar(meta.stage, "goal", event.target.value)}
                placeholder={`Qué hay que lograr — ${meta.ayuda.toLowerCase()}`}
              />
              <Textarea
                rows={3}
                value={etapa?.script ?? ""}
                onChange={(event) => actualizar(meta.stage, "script", event.target.value)}
                placeholder="Qué decir…"
              />
            </div>
          );
        })}

        <div className="flex items-center gap-3">
          <Button type="button" size="sm" onClick={() => void guardar()} disabled={ocupado}>
            Guardar embudo
          </Button>
          {hayCambios || vienenDelAgente ? (
            <span className="text-xs text-amber-700 dark:text-amber-300">Sin guardar</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              Guardado
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
