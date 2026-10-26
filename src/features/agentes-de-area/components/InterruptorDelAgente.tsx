import { cambiarInterruptorAgenteDeMarketingAction, cambiarInterruptorAgenteDeVentasAction } from "@/app/actions/agentes-de-area-actions";
import { Badge } from "@/components/ui/badge";
import { FormActionSwitch } from "@/components/ui/form-action-switch";

/** El interruptor del agente. Empieza APAGADO: apagado, el agente solo genera el resumen y no manda nada. */
export function InterruptorDelAgente({ activo, puedeCambiar, area = "ventas" }: { activo: boolean; puedeCambiar: boolean; area?: "ventas" | "marketing" }) {
  const marketing = area === "marketing";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Badge variant={activo ? "default" : "outline"}>{activo ? "Prendido" : "Apagado"}</Badge>
      {puedeCambiar ? (
        <FormActionSwitch
          action={marketing ? cambiarInterruptorAgenteDeMarketingAction : cambiarInterruptorAgenteDeVentasAction}
          checked={activo}
          ariaLabel={marketing ? "Prender o apagar el Agente de Marketing" : "Prender o apagar el Agente de Ventas"}
          hiddenFields={[{ name: "activo", value: activo ? "false" : "true" }]}
        />
      ) : null}
      <span className="text-xs text-muted-foreground">
        {marketing
          ? activo
            ? "Su línea de marketing va en el mensaje de las 7:30 de Alexander."
            : "Su línea NO va en el mensaje de las 7:30: solo se genera el resumen."
          : activo
          ? "Los mensajes salen a las 7:30 (uno a Alexander y uno a cada asesora)."
          : "No sale ningún mensaje: solo se genera el resumen."}
      </span>
    </div>
  );
}
