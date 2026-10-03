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
  /** Si viene, se manda ese flujo (textos, fotos y videos) en vez del texto. */
  flowId: string | null;
  cancelOnActivity: boolean;
};

/**
 * Programar un "si no contesta" de una etapa.
 *
 * En modal y no como campos sueltos dentro de la etapa: al lado del objetivo y el guion, dos
 * campos mas convertian la etapa en un formulario largo, y en el celular el renglon de los dias
 * se partia en dos. Aparte, un seguimiento no es UN dato: es cuando, que mandar y si se cancela.
 * Eso pide su propia ventana, igual que "Programar seguimiento" del modulo Seguimientos.
 *
 * Puede mandar un texto o un FLUJO entero (Alex, 02-10-2026): a veces lo que destraba al cliente
 * callado no es una pregunta sino volver a ver el video del producto.
 */
export function StageFollowUpDialog({
  abierto,
  etapaLabel,
  seguimiento,
  flujos = [],
  onGuardar,
  onCerrar,
}: {
  abierto: boolean;
  etapaLabel: string;
  /** Los flujos que se pueden mandar en vez de un texto. */
  flujos?: Array<{ id: string; title: string }>;
  /** El que se esta editando, o null si es uno nuevo. */
  seguimiento: SeguimientoDeEtapa | null;
  onGuardar: (seguimiento: SeguimientoDeEtapa) => void;
  onCerrar: () => void;
}) {
  const [unidad, setUnidad] = useState<SeguimientoDeEtapa["timeType"]>("DAYS");
  const [valor, setValor] = useState("2");
  const [texto, setTexto] = useState("");
  const [tipo, setTipo] = useState<"texto" | "flujo">("texto");
  const [flujoId, setFlujoId] = useState("");
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
    setTipo(seguimiento?.flowId ? "flujo" : "texto");
    setFlujoId(seguimiento?.flowId ?? "");
    setCancelar(seguimiento?.cancelOnActivity ?? true);
  }, [abierto, seguimiento]);

  const numero = Number(valor);
  const valido =
    Number.isInteger(numero) &&
    numero > 0 &&
    numero <= 999 &&
    (tipo === "flujo" ? flujoId.length > 0 : texto.trim().length > 0);

  const guardar = () => {
    if (!valido) {
      return;
    }
    onGuardar({
      key: seguimiento?.key ?? `nuevo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timeType: unidad,
      timeValue: String(numero),
      content: tipo === "flujo" ? "" : texto.trim(),
      flowId: tipo === "flujo" ? flujoId : null,
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
            <div className="inline-flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Qué mandarle">
              {(["texto", "flujo"] as const).map((opcion) => (
                <button
                  key={opcion}
                  type="button"
                  role="radio"
                  aria-checked={tipo === opcion}
                  onClick={() => setTipo(opcion)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                    tipo === opcion ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opcion === "texto" ? "Un mensaje" : "Un flujo"}
                </button>
              ))}
            </div>
            {tipo === "texto" ? (
              <Textarea
                rows={4}
                value={texto}
                onChange={(evento) => setTexto(evento.target.value)}
                placeholder="Hola [Nombre], ¿alcanzaste a ver la información que te mandé?"
              />
            ) : flujos.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Todavía no hay flujos creados. Se arman en la pantalla de Flujos.
              </p>
            ) : (
              <>
                <NativeSelect value={flujoId} onChange={(evento) => setFlujoId(evento.target.value)} className="w-full">
                  <NativeSelectOption value="">Elige un flujo…</NativeSelectOption>
                  {flujos.map((flujo) => (
                    <NativeSelectOption key={flujo.id} value={flujo.id}>
                      {flujo.title}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <p className="text-xs text-muted-foreground">
                  Sale el flujo completo, con sus textos, fotos y videos en orden. Si el cliente no
                  leyó lo último que le mandamos, no sale, igual que un mensaje.
                </p>
              </>
            )}
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
              <span className="text-foreground">Recomendado:</span> si lo apagas, el mensaje sale
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
