"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

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
import { contarPublicoAction, crearCampanaAction } from "@/app/actions/campaign-actions";

export type EtapaDelPublico = { value: string; label: string; total: number };

/**
 * Armar una campaña. Mismos campos y mismo orden que crear un seguimiento, para que no haya que
 * aprender dos formularios distintos para dos cosas que se sienten parecidas.
 *
 * La diferencia esta abajo: la cantidad por tanda y cada cuanto sale una tanda. No son opciones
 * avanzadas escondidas —son el freno que evita que WhatsApp bloquee la linea— y por eso se ven
 * siempre, con el resumen de cuanto va a tardar la campaña entera escrito en palabras.
 */
export function NuevaCampanaDialog({
  abierto,
  etapas,
  canales,
  onCerrar,
  onCreada,
}: {
  abierto: boolean;
  etapas: EtapaDelPublico[];
  canales: Array<{ id: string; name: string }>;
  onCerrar: () => void;
  onCreada: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [etapa, setEtapa] = useState(etapas[0]?.value ?? "");
  const [canalId, setCanalId] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [porTanda, setPorTanda] = useState("20");
  const [cadaMinutos, setCadaMinutos] = useState("30");
  const [publico, setPublico] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // El tamaño del publico se pide al servidor y no se toma del conteo de la lista: la lista se
  // dibujo cuando cargo la pantalla y un lead pudo cambiar de etapa desde entonces. Antes de
  // mandarle algo a gente real, el numero tiene que ser de ahora.
  useEffect(() => {
    if (!abierto || !etapa) {
      return;
    }
    let vigente = true;
    setPublico(null);
    contarPublicoAction({ crmStage: etapa })
      .then((resultado) => {
        if (vigente && typeof resultado.total === "number") {
          setPublico(resultado.total);
        }
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [abierto, etapa]);

  const tanda = Number(porTanda);
  const cada = Number(cadaMinutos);
  const valido =
    nombre.trim().length > 0 &&
    mensaje.trim().length > 0 &&
    Number.isInteger(tanda) &&
    tanda >= 1 &&
    tanda <= 50 &&
    Number.isInteger(cada) &&
    cada >= 5 &&
    cada <= 1440;

  const cuantoTarda = (() => {
    if (!publico || !valido) {
      return null;
    }
    const tandas = Math.ceil(publico / tanda);
    const minutos = (tandas - 1) * cada;
    if (minutos < 60) return `${tandas} tandas · termina en ${minutos} min`;
    const horas = Math.round((minutos / 60) * 10) / 10;
    if (horas < 24) return `${tandas} tandas · termina en ${horas} h`;
    return `${tandas} tandas · termina en ${Math.round((horas / 24) * 10) / 10} días`;
  })();

  const crear = async () => {
    setOcupado(true);
    try {
      const resultado = await crearCampanaAction({
        name: nombre,
        crmStage: etapa,
        channelId: canalId || null,
        content: mensaje,
        batchSize: tanda,
        intervalMinutes: cada,
      });
      if (resultado?.error) {
        toast.error(resultado.error);
        return;
      }
      toast.success("Campaña creada. Todavía no mandó nada: revisala y dale Iniciar.");
      setNombre("");
      setMensaje("");
      onCreada();
    } catch {
      toast.error("No se pudo crear. Recargá la página e intentá de nuevo.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Dialog open={abierto} onOpenChange={(estado) => !estado && onCerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle className="text-sm">Nueva campaña</DialogTitle>
          <DialogDescription className="text-xs">
            Se crea apagada. No sale ningún mensaje hasta que le des Iniciar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Nombre</Label>
            <Input
              value={nombre}
              onChange={(evento) => setNombre(evento.target.value)}
              placeholder="Reactivar fríos de camillas"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">A quién le llega</Label>
            <NativeSelect value={etapa} onChange={(evento) => setEtapa(evento.target.value)}>
              {etapas.map((item) => (
                <NativeSelectOption key={item.value} value={item.value}>
                  {item.label} ({item.total})
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p className="text-[11px] text-muted-foreground">
              {publico === null ? (
                "Contando…"
              ) : (
                <>
                  <span className="font-medium text-foreground tabular-nums">{publico}</span> leads
                  con teléfono en esta etapa.
                </>
              )}
            </p>
          </div>

          {canales.length > 1 ? (
            <div className="space-y-2">
              <Label className="text-xs">Desde qué línea</Label>
              <NativeSelect value={canalId} onChange={(evento) => setCanalId(evento.target.value)}>
                <NativeSelectOption value="">La primera disponible</NativeSelectOption>
                {canales.map((canal) => (
                  <NativeSelectOption key={canal.id} value={canal.id}>
                    {canal.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label className="text-xs">Qué mandarles</Label>
            <Textarea
              rows={4}
              value={mensaje}
              onChange={(evento) => setMensaje(evento.target.value)}
              placeholder="Hola, te escribo de Magilus…"
            />
          </div>

          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <Label className="text-xs">Ritmo de envío</Label>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Input
                type="number"
                min={1}
                max={50}
                inputMode="numeric"
                value={porTanda}
                onChange={(evento) => setPorTanda(evento.target.value)}
                className="w-20 tabular-nums"
              />
              <span>leads cada</span>
              <Input
                type="number"
                min={5}
                max={1440}
                inputMode="numeric"
                value={cadaMinutos}
                onChange={(evento) => setCadaMinutos(evento.target.value)}
                className="w-20 tabular-nums"
              />
              <span>minutos</span>
            </div>
            {cuantoTarda ? (
              <p className="text-[11px] text-muted-foreground">{cuantoTarda}</p>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              Mandar todo junto es lo que hace que WhatsApp bloquee la línea. De a poco tarda más,
              pero el número sigue vivo.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="button" size="sm" onClick={() => void crear()} disabled={!valido || ocupado}>
            Crear campaña
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
