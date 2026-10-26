import { cambiarInterruptorAgenteDeVentasAction } from "@/app/actions/agentes-de-area-actions";
import { Badge } from "@/components/ui/badge";
import { FormActionSwitch } from "@/components/ui/form-action-switch";

/** El interruptor del agente. Empieza APAGADO: apagado, el agente solo genera el resumen y no manda nada. */
export function InterruptorDelAgente({ activo, puedeCambiar }: { activo: boolean; puedeCambiar: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Badge variant={activo ? "default" : "outline"}>{activo ? "Prendido" : "Apagado"}</Badge>
      {puedeCambiar ? (
        <FormActionSwitch
          action={cambiarInterruptorAgenteDeVentasAction}
          checked={activo}
          ariaLabel="Prender o apagar el Agente de Ventas"
          hiddenFields={[{ name: "activo", value: activo ? "false" : "true" }]}
        />
      ) : null}
      <span className="text-xs text-muted-foreground">
        {activo
          ? "Los mensajes salen a las 7:30 (uno a Alexander y uno a cada asesora)."
          : "No sale ningún mensaje: solo se genera el resumen."}
      </span>
    </div>
  );
}
