"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createChatFollowUpAction } from "@/app/actions/follow-actions";
import {
  MAXIMO_DIAS_FECHA_EXACTA,
  ahoraEnBogotaParaInput,
  formatoBogota,
  horaDeBogotaAUtc,
  validarFechaExacta,
} from "@/features/seguimientos/dominio/fecha-exacta";

// Atajos de cuando volver a escribir. Son los tiempos que se usan de verdad al vender: mismo dia,
// al otro dia, o unos dias despues. Sin esto habria que llenar un formulario para cada seguimiento.
const PRESETS: Array<{ label: string; timeType: "HOURS" | "DAYS"; timeValue: number }> = [
  { label: "En 2 horas", timeType: "HOURS", timeValue: 2 },
  { label: "Mañana", timeType: "DAYS", timeValue: 1 },
  { label: "En 2 días", timeType: "DAYS", timeValue: 2 },
  { label: "En 3 días", timeType: "DAYS", timeValue: 3 },
  { label: "En 1 semana", timeType: "DAYS", timeValue: 7 },
];

// Sexto boton: la asesora escoge dia y hora exactos en el calendario (siempre hora de Colombia).
const OTRA_FECHA = PRESETS.length;
const DIA_MS = 24 * 60 * 60 * 1000;

// Siempre en hora de Colombia, aunque el aparato de la asesora este en otra zona.
function formatWhen(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  return formatoBogota(date);
}

/**
 * "Agendar seguimiento" desde el chat: la asesora elige cuándo y qué escribir, y el mensaje sale
 * solo a esa hora. Si el cliente responde antes, se cancela (no lo perseguimos).
 */
export function FollowUpDialog({
  open,
  onClose,
  contactId,
}: {
  open: boolean;
  onClose: () => void;
  contactId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [presetIndex, setPresetIndex] = useState(1);
  const [content, setContent] = useState("");
  const [fechaExacta, setFechaExacta] = useState("");

  useEffect(() => {
    if (open) {
      setPresetIndex(1);
      setContent("");
      setFechaExacta("");
    }
  }, [open]);

  const esOtraFecha = presetIndex === OTRA_FECHA;
  const ahora = new Date();
  const fechaElegida = fechaExacta ? horaDeBogotaAUtc(fechaExacta) : null;
  const validacion = fechaElegida ? validarFechaExacta(fechaElegida, ahora) : null;
  const fechaValida = Boolean(fechaElegida && validacion?.ok);
  const faltaFecha = esOtraFecha && !fechaValida;

  const handleSave = () => {
    if (!contactId) {
      toast.error("No se pudo identificar el contacto.");
      return;
    }
    if (faltaFecha) {
      return;
    }
    const preset = esOtraFecha ? null : PRESETS[presetIndex];
    startTransition(async () => {
      const result = await createChatFollowUpAction(
        preset
          ? { contactId, timeType: preset.timeType, timeValue: preset.timeValue, content }
          : // El schema exige timeType/timeValue; con fechaExacta el servidor los ignora.
            { contactId, timeType: "MINUTES", timeValue: 1, content, fechaExacta },
      );
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const when = formatWhen(result.executeAt);
      toast.success(when ? `Seguimiento agendado para el ${when}` : "Seguimiento agendado");
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          {/*
            Sin bajada: decia lo mismo que la nota del final ("si el cliente escribe antes, el
            seguimiento se cancela solo"), asi que era la misma frase dos veces en una ventana
            que se abre para hacer una cosa rapida.
          */}
          <DialogTitle>Agendar seguimiento</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>¿Cuándo?</Label>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((preset, index) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setPresetIndex(index)}
                  className={`rounded-full border px-3 py-1.5 text-[13px] transition ${
                    index === presetIndex
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "border-border text-foreground hover:bg-muted"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPresetIndex(OTRA_FECHA)}
                className={`rounded-full border px-3 py-1.5 text-[13px] transition ${
                  esOtraFecha
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "border-border text-foreground hover:bg-muted"
                }`}
              >
                Otra fecha
              </button>
            </div>
            {esOtraFecha ? (
              <div className="space-y-1">
                <input
                  type="datetime-local"
                  value={fechaExacta}
                  onChange={(evento) => setFechaExacta(evento.target.value)}
                  min={ahoraEnBogotaParaInput(ahora)}
                  max={ahoraEnBogotaParaInput(new Date(ahora.getTime() + MAXIMO_DIAS_FECHA_EXACTA * DIA_MS))}
                  className="h-9 w-full min-w-0 rounded-xl border border-border bg-card px-2.5 text-[13px] text-foreground outline-none"
                  aria-label="Fecha y hora del seguimiento (hora de Colombia)"
                />
                {fechaElegida && validacion?.ok ? (
                  <p className="text-[12px] text-muted-foreground">
                    Sale el {formatoBogota(fechaElegida)} (hora de Colombia)
                  </p>
                ) : validacion && !validacion.ok ? (
                  <p className="text-[12px] text-destructive">
                    {validacion.motivo === "pasada"
                      ? "Escoge una fecha y hora que todavía no haya pasado"
                      : `Escoge una fecha dentro de los próximos ${MAXIMO_DIAS_FECHA_EXACTA} días`}
                  </p>
                ) : fechaExacta ? (
                  <p className="text-[12px] text-destructive">Escoge una fecha y hora completas</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="followUpContent">Mensaje que se va a enviar</Label>
            <Textarea
              id="followUpContent"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={4}
              placeholder="Ej. Hola 😊 ¿Pudiste ver las fotos del combo? Quedo atenta."
            />
          </div>

          <p className="rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground">
            Si el cliente escribe antes de esa fecha, el seguimiento se cancela solo.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isPending || content.trim().length < 2 || faltaFecha}>
            {isPending ? "Agendando…" : "Agendar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
