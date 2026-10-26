"use client";

import { useState } from "react";
import { Brain, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { pasarAlCerebroAction, prepararPasoAlCerebroAction } from "@/app/actions/cerebro-actions";
import { textoDelPaso } from "@/features/cerebro/services/textos";
import type { PreparacionDelPaso } from "@/features/cerebro/services/pasar";

const NUEVO = "__nuevo__";

/**
 * "Pasar al cerebro": en una tarjeta HECHA (o de un tipo "Decisión") escribe SOLO la conclusión en el
 * documento del cerebro (Google Drive) que el dueño elija, con la fecha y el link a la tarjeta.
 */
export function PasarAlCerebro({ tarjetaId }: { tarjetaId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [datos, setDatos] = useState<PreparacionDelPaso | null>(null);
  const [conclusion, setConclusion] = useState("");
  const [destino, setDestino] = useState("");
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [carpeta, setCarpeta] = useState("");

  const abrir = async () => {
    setCargando(true);
    const respuesta = await prepararPasoAlCerebroAction(tarjetaId);
    setCargando(false);
    if (!respuesta.ok) {
      toast.error(respuesta.error);
      return;
    }
    setDatos(respuesta.datos);
    setConclusion(respuesta.datos.conclusion);
    setDestino(respuesta.datos.sugerido?.driveId ?? NUEVO);
    setNombreNuevo(respuesta.datos.titulo);
    setCarpeta("");
    setAbierto(true);
  };

  const guardar = async () => {
    if (!datos) return;
    setGuardando(true);
    const respuesta = await pasarAlCerebroAction({
      tarjetaId,
      conclusion,
      ...(destino === NUEVO ? { nombreNuevo, carpetaId: carpeta || null } : { driveId: destino }),
    });
    setGuardando(false);
    if (respuesta.ok) {
      toast.success(`Quedó en el cerebro: ${respuesta.documento}`);
      setAbierto(false);
    } else toast.error(respuesta.error);
  };

  const vista = datos ? textoDelPaso({ conclusion, titulo: datos.titulo, link: datos.link }) : "";

  return (
    <>
      <Button variant="outline" className="h-10 w-full justify-start" onClick={() => void abrir()} disabled={cargando}>
        {cargando ? <Loader2 className="animate-spin" /> : <Brain />}
        Pasar al cerebro
      </Button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Pasar al cerebro</DialogTitle>
            <DialogDescription>Se guarda solo la conclusión, con la fecha y el link a la tarjeta. No se copia la tarjeta entera.</DialogDescription>
          </DialogHeader>
          {datos && !datos.conectado ? (
            <p className="text-sm text-destructive">El cerebro no está conectado a Google Drive todavía (Mi empresa → Cerebro).</p>
          ) : datos ? (
            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Conclusión</span>
                <Textarea rows={5} value={conclusion} onChange={(e) => setConclusion(e.target.value)} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Dónde guardarla</span>
                <NativeSelect value={destino} onChange={(e) => setDestino(e.target.value)}>
                  <NativeSelectOption value={NUEVO}>Un documento nuevo</NativeSelectOption>
                  {datos.documentos.map((documento) => (
                    <NativeSelectOption key={documento.driveId} value={documento.driveId}>
                      Agregar a: {documento.ruta}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              {destino === NUEVO ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Nombre del documento</span>
                    <Input value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Carpeta</span>
                    <NativeSelect value={carpeta} onChange={(e) => setCarpeta(e.target.value)}>
                      {datos.carpetas.map((c) => (
                        <NativeSelectOption key={c.driveId ?? "raiz"} value={c.driveId ?? ""}>
                          {c.ruta}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                </div>
              ) : null}
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Vista previa de lo que se escribe</span>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-2 text-xs">{vista}</pre>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void guardar()} disabled={guardando || !datos?.conectado || !conclusion.trim()}>
              {guardando ? <Loader2 className="animate-spin" /> : null}
              Guardar en el cerebro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
