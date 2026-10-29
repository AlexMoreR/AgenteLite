"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { BellRing, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import {
  avisosAlDuenoAction,
  guardarAvisosAlDuenoAction,
  mandarPruebaDeAvisosAction,
  type AvisosAlDuenoVista,
} from "@/app/actions/tableros-inteligentes-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

/*
  Caja "Avisos de Sistemas por WhatsApp" de Mi empresa → Claude (solo dueño o administrador). El dueño pone su
  número personal, prende o apaga los avisos (empiezan prendidos), manda una prueba y ve los últimos avisos y por
  qué no salieron. Solo avisan cuando Sistemas se detiene o necesita algo (services/avisos-al-dueno.ts).
  El número se valida en el servidor.
*/

const FECHA = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function AvisosAlDueno() {
  const [avisos, setAvisos] = useState<AvisosAlDuenoVista | null>(null);
  const [telefono, setTelefono] = useState("");
  const [telefonoSistemas, setTelefonoSistemas] = useState("");
  const [ocupado, empezar] = useTransition();

  const cargar = useCallback(async () => {
    const respuesta = await avisosAlDuenoAction();
    if (!respuesta.ok) {
      toast.error(respuesta.error);
      return;
    }
    setAvisos(respuesta.avisos);
    setTelefono(respuesta.avisos.telefono ?? "");
    setTelefonoSistemas(respuesta.avisos.telefonoSistemas ?? "");
  }, []);

  useEffect(() => {
    let vigente = true;
    void avisosAlDuenoAction().then((respuesta) => {
      if (!vigente) return;
      if (respuesta.ok) {
        setAvisos(respuesta.avisos);
        setTelefono(respuesta.avisos.telefono ?? "");
        setTelefonoSistemas(respuesta.avisos.telefonoSistemas ?? "");
      } else toast.error(respuesta.error);
    });
    return () => {
      vigente = false;
    };
  }, []);

  const guardar = (cambios: { telefono?: string; activo?: boolean; telefonoSistemas?: string; activoSistemas?: boolean }, bien: string) =>
    empezar(async () => {
      const respuesta = await guardarAvisosAlDuenoAction(cambios);
      if (respuesta.ok) toast.success(bien);
      else toast.error(respuesta.error);
      await cargar();
    });

  const probar = () =>
    empezar(async () => {
      const respuesta = await mandarPruebaDeAvisosAction();
      if (respuesta.ok) toast.success("Prueba enviada: revise su WhatsApp");
      else toast.error(respuesta.error);
      await cargar();
    });

  return (
    <section aria-labelledby="titulo-avisos-sistemas" className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-6">
      <div>
        <h2 id="titulo-avisos-sistemas" className="flex items-center gap-2 text-base font-semibold">
          <BellRing className="size-5 text-muted-foreground" aria-hidden />
          Avisos de Sistemas por WhatsApp
        </h2>
        <p className="text-sm text-muted-foreground">
          Solo le escribimos cuando Sistemas se detiene o necesita algo suyo: el Coordinador apagado, sin trabajo, una tarea trabada, algo
          que necesita su decisión o el límite de Claude. Lo demás se ve en el tablero. Silencio de 9:00 p. m. a 7:00 a. m.
        </p>
      </div>

      {!avisos ? <Loader2 className="mx-auto animate-spin text-muted-foreground" aria-label="Cargando" /> : null}

      {avisos ? (
        <>
          <label className="flex items-center gap-3 text-sm">
            <Switch
              checked={avisos.activo}
              disabled={ocupado}
              onCheckedChange={(valor) => guardar({ activo: Boolean(valor) }, valor ? "Avisos prendidos" : "Avisos apagados")}
            />
            <span className="font-medium">{avisos.activo ? "Prendidos" : "Apagados"}</span>
          </label>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={telefono}
              onChange={(evento) => setTelefono(evento.target.value)}
              inputMode="tel"
              placeholder="Su número personal, con indicativo (573001234567)"
              aria-label="Su número personal de WhatsApp"
              disabled={ocupado}
              className="sm:max-w-xs"
            />
            <Button type="button" variant="outline" disabled={ocupado} onClick={() => guardar({ telefono }, "Número guardado")}>
              Guardar número
            </Button>
            <Button type="button" disabled={ocupado || !avisos.telefono} onClick={probar}>
              {ocupado ? <Loader2 className="animate-spin" /> : <Send />}
              Mandar prueba
            </Button>
          </div>

          <div className="space-y-2 rounded-lg border bg-background p-3 text-sm">
            <p className="font-medium">WhatsApp de Sistemas (Emanuel)</p>
            <p className="text-muted-foreground">
              Las alertas técnicas (tarjetas en error, atascadas, el Coordinador caído o sin trabajo, el límite de uso) le llegan a él. Lo de
              dinero, Meta Ads o claves sigue llegando a usted. Sin su número, todo le sigue llegando a usted.
            </p>
            <label className="flex items-center gap-3">
              <Switch
                checked={avisos.activoSistemas}
                disabled={ocupado}
                onCheckedChange={(valor) => guardar({ activoSistemas: Boolean(valor) }, valor ? "Avisos de Sistemas prendidos" : "Avisos de Sistemas apagados")}
              />
              <span className="font-medium">{avisos.activoSistemas ? "Prendidos" : "Apagados"}</span>
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={telefonoSistemas}
                onChange={(evento) => setTelefonoSistemas(evento.target.value)}
                inputMode="tel"
                placeholder="Número de Emanuel, con indicativo (573001234567)"
                aria-label="Número de WhatsApp de Sistemas"
                disabled={ocupado}
                className="sm:max-w-xs"
              />
              <Button type="button" variant="outline" disabled={ocupado} onClick={() => guardar({ telefonoSistemas }, "Número de Sistemas guardado")}>
                Guardar número
              </Button>
            </div>
          </div>

          <div className="space-y-1 text-sm">
            <p className="font-medium">Últimos avisos</p>
            {avisos.ultimos.length ? (
              <ul className="space-y-2">
                {avisos.ultimos.slice(0, 10).map((aviso, indice) => (
                  <li key={`${aviso.cuando}-${indice}`} className="rounded-lg border bg-background p-2">
                    <p className="text-xs text-muted-foreground">
                      {FECHA.format(new Date(aviso.cuando))} · {aviso.salio ? "salió" : (aviso.motivo ?? "no salió")}
                    </p>
                    <p className="whitespace-pre-line">{aviso.texto}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">Todavía no ha salido ninguno.</p>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
