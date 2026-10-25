"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { BellRing, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { avisosAlDuenoAction, guardarAvisosAlDuenoAction, mandarPruebaDeAvisosAction, type AvisosAlDuenoVista } from "@/app/actions/tableros-inteligentes-actions";

/*
  Caja "Avisos de Sistemas por WhatsApp" de Mi empresa → Claude (solo dueño o administrador): el número
  personal del dueño, el interruptor (prendido por defecto), el botón "Mandar prueba" y los últimos avisos.
  Solo se avisa cuando Sistemas se detiene o necesita algo (services/avisos-al-dueno.ts).
*/

const FECHA = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function AvisosAlDueno() {
  const [avisos, setAvisos] = useState<AvisosAlDuenoVista | null>(null);
  const [numero, setNumero] = useState("");
  const [ocupado, empezar] = useTransition();

  const cargar = useCallback(async () => {
    const respuesta = await avisosAlDuenoAction();
    if (!respuesta.ok) {
      toast.error(respuesta.error);
      return;
    }
    setAvisos(respuesta.avisos);
    setNumero(respuesta.avisos.numero ?? "");
  }, []);

  useEffect(() => {
    let vivo = true;
    void avisosAlDuenoAction().then((respuesta) => {
      if (!vivo || !respuesta.ok) return;
      setAvisos(respuesta.avisos);
      setNumero(respuesta.avisos.numero ?? "");
    });
    return () => {
      vivo = false;
    };
  }, []);

  const guardar = (prendidos: boolean, mensajeOk: string) =>
    empezar(async () => {
      const respuesta = await guardarAvisosAlDuenoAction(numero, prendidos);
      if (respuesta.ok) toast.success(mensajeOk);
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
    <section aria-labelledby="titulo-avisos-sistemas" className="space-y-3 rounded-2xl border bg-card p-4 sm:p-6">
      <div className="space-y-1">
        <h2 id="titulo-avisos-sistemas" className="flex items-center gap-2 text-base font-semibold">
          <BellRing className="size-4" aria-hidden /> Avisos de Sistemas por WhatsApp
        </h2>
        <p className="text-sm text-muted-foreground">
          Le escribimos solo si el trabajo de Sistemas se detiene o necesita algo de usted: el Coordinador apagado, sin trabajo, una tarjeta trabada o en error, una
          decisión suya o el límite de Claude. Lo demás lo ve en el tablero. No escribimos de 9:00 p. m. a 7:00 a. m., salvo que el Coordinador esté caído.
        </p>
      </div>

      {avisos ? (
        <>
          <label className="flex items-center gap-3 text-sm">
            <Switch
              checked={avisos.prendidos}
              disabled={ocupado}
              onCheckedChange={(valor) => guardar(Boolean(valor), valor ? "Avisos prendidos" : "Avisos apagados")}
            />
            <span>{avisos.prendidos ? "Prendidos" : "Apagados: no sale ningún WhatsApp"}</span>
          </label>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm">
              <span className="font-medium">Su número personal (con indicativo)</span>
              <Input value={numero} inputMode="tel" placeholder="573001234567" onChange={(evento) => setNumero(evento.target.value)} disabled={ocupado} />
            </label>
            <Button type="button" variant="outline" disabled={ocupado} onClick={() => guardar(avisos.prendidos, "Número guardado")}>
              Guardar
            </Button>
            <Button type="button" disabled={ocupado || !avisos.numero} onClick={probar}>
              {ocupado ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Mandar prueba
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Sale siempre por la línea Admin y solo a este número; no se acepta el de una asesora, una línea del negocio ni un cliente.</p>

          <div className="space-y-1">
            <h3 className="text-sm font-medium">Últimos avisos</h3>
            {avisos.ultimos.length ? (
              <ul className="space-y-1 text-sm">
                {avisos.ultimos.map((aviso) => (
                  <li key={`${aviso.cuando}-${aviso.tipos}`} className="rounded-lg border p-2">
                    <p className="text-xs text-muted-foreground">
                      {FECHA.format(new Date(aviso.cuando))} · {aviso.salio ? "salió" : `no salió: ${aviso.motivo ?? "sin motivo"}`}
                    </p>
                    <p className="whitespace-pre-line">{aviso.texto}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Todavía no ha salido ninguno.</p>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      )}
    </section>
  );
}
