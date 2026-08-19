"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type SeguimientoDeEtapa = {
  /** Solo para React: el guardado reemplaza la lista entera y no usa este id. */
  key: string;
  timeType: "MINUTES" | "HOURS" | "DAYS";
  timeValue: string;
  content: string;
  cancelOnActivity: boolean;
};

/**
 * Programar un "si no contesta" de una etapa.
 *
 * En modal y no como campos sueltos dentro de la etapa: al lado del objetivo y el guion, dos
 * campos mas convertian la etapa en un formulario largo, y en el celular el renglon de los dias
 * se partia en dos. Aparte, un seguimiento no es UN dato: es cuando, que mandar y si se cancela.
 * Eso pide su propia ventana, igual que "Programar seguimiento" del modulo Seguimientos.
 */
export function StageFollowUpDialog({
  abierto,
  etapaLabel,
  seguimiento,
  onGuardar,
  onCerrar,
}: {
  abierto: boolean;
  etapaLabel: string;
  /** El que se esta editando, o null si es uno nuevo. */
  seguimiento: SeguimientoDeEtapa | null;
  onGuardar: (seguimiento: SeguimientoDeEtapa) => void;
  onCerrar: () => void;
}) {
  const [unidad, setUnidad] = useState<SeguimientoDeEtapa["timeType"]>("DAYS");
  const [valor, setValor] = useState("2");
  const [texto, setTexto] = useState("");
  const [cancelar, setCancelar] = useState(true);

  // Se recarga al abrir y no al montar: el mismo modal sirve para cada seguimiento de cada etapa,
  // y sin esto el segundo que abris muestra lo que escribiste en el primero.
  useEffect(() => {
    if (!abierto) {
      return;
    }
    setUnidad(seguimiento?.timeType ?? "DAYS");
    setValor(seguimiento?.timeValue ?? "2");
    setTexto(seguimiento?.content ?? "");
    setCancelar(seguimiento?.cancelOnActivity ?? true);
  }, [abierto, seguimiento]);

  const numero = Number(valor);
  const valido = Number.isInteger(numero) && numero > 0 && numero <= 999 && texto.trim().length > 0;

  const guardar = () => {
    if (!valido) {
      return;
    }
    onGuardar({
      key: seguimiento?.key ?? `nuevo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timeType: unidad,
      timeValue: String(numero),
      content: texto.trim(),
      cancelOnActivity: cancelar,
    });
  };

  return (
    <Dialog open={abierto} onOpenChange={(estado) => !estado && onCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle className="text-sm">
            {seguimiento ? "Editar seguimiento" : "Nuevo seguimiento"}
          </DialogTitle>
          {/* Solo para lectores de pantalla: lo que hace el seguimiento ya lo dicen los campos
              ("Cuando mandarlo", "Que mandarle") y la casilla de abajo. */}
          <DialogDescription className="sr-only">
            Se manda solo si el cliente no responde, contando desde que entra a &quot;{etapaLabel}&quot;.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Cuándo mandarlo</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={999}
                inputMode="numeric"
                value={valor}
                onChange={(evento) => setValor(evento.target.value)}
                className="w-24 tabular-nums"
              />
              <NativeSelect
                value={unidad}
                onChange={(evento) =>
                  setUnidad(evento.target.value as SeguimientoDeEtapa["timeType"])
                }
                className="flex-1"
              >
                <NativeSelectOption value="MINUTES">minutos después</NativeSelectOption>
                <NativeSelectOption value="HOURS">horas después</NativeSelectOption>
                <NativeSelectOption value="DAYS">días después</NativeSelectOption>
              </NativeSelect>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Qué mandarle</Label>
            <Textarea
              rows={4}
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
              placeholder="Hola [Nombre], ¿alcanzaste a ver la información que te mandé?"
            />
          </div>

          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={cancelar}
              onChange={(evento) => setCancelar(evento.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-current"
            />
            <span className="text-xs text-muted-foreground">
              No mandarlo si el cliente responde antes.{" "}
              <span className="text-foreground">Recomendado:</span> si lo apagás, el mensaje sale
              igual aunque el cliente ya te haya contestado.
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="button" size="sm" onClick={guardar} disabled={!valido}>
            {seguimiento ? "Guardar cambios" : "Agregar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
