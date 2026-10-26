"use client";

import { useState, useTransition } from "react";
import { BellRing, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  avisosAlDuenoAction,
  cambiarAvisosAlDuenoAction,
  guardarTelefonoDeAvisosAction,
  mandarPruebaDeAvisosAction,
  type AvisosAlDuenoVista,
} from "@/app/actions/tableros-inteligentes-actions";

/*
  Caja "Avisos de Sistemas por WhatsApp" de Mi empresa → Claude (solo el dueño o un administrador). El dueño
  guarda su número personal, prende o apaga los avisos (empieza prendido) y manda una prueba. Abajo se ven los
  últimos avisos y si salieron. Las reglas (qué avisa, silencio de 9:00 p. m. a 7:00 a. m.) están en
  services/avisos-al-dueno.ts; el número se valida en el servidor.
*/

const FECHA = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function AvisosAlDueno({ inicial }: { inicial: AvisosAlDuenoVista }) {
  const [avisos, setAvisos] = useState(inicial);
  const [telefono, setTelefono] = useState(inicial.telefono ?? "");
  const [ocupado, empezar] = useTransition();

  const recargar = async () => {
    const respuesta = await avisosAlDuenoAction();
    if (respuesta.ok) setAvisos(respuesta.avisos);
  };

  const hacer = (accion: () => Promise<{ ok: true } | { ok: false; error: string }>, exito: string) =>
    empezar(async () => {
      const respuesta = await accion();
      if (respuesta.ok) toast.success(exito);
      else toast.error(respuesta.error);
      await recargar();
    });

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4 text-sm">
      <div className="flex items-start gap-2">
        <BellRing className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
        <div>
          <h2 className="font-medium">Avisos de Sistemas por WhatsApp</h2>
          <p className="text-xs text-muted-foreground">
            Te escribimos solo si Sistemas se detiene o te necesita: el Coordinador apagado, sin trabajo, una tarea trabada, algo que
            solo tú puedes decidir o el límite de Claude. Salen desde la línea Admin a tu número, nunca a clientes ni asesoras, y callan de
            9:00 p. m. a 7:00 a. m. (salvo si el Coordinador se cae).
          </p>
        </div>
      </div>

      <label className="flex items-center gap-3">
        <Switch
          checked={avisos.prendidos}
          disabled={ocupado}
          onCheckedChange={(valor) =>
            hacer(() => cambiarAvisosAlDuenoAction(Boolean(valor)), valor ? "Avisos prendidos" : "Avisos apagados")
          }
        />
        <span>{avisos.prendidos ? "Prendidos" : "Apagados"}</span>
      </label>

      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Tu número personal (con indicativo, p. ej. 573001234567)</span>
          <Input value={telefono} onChange={(evento) => setTelefono(evento.target.value)} inputMode="tel" placeholder="573001234567" className="w-60" />
        </label>
        <Button type="button" size="sm" disabled={ocupado || !telefono.trim()} onClick={() => hacer(() => guardarTelefonoDeAvisosAction(telefono), "Número guardado")}>
          Guardar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={ocupado || !avisos.telefono}
          onClick={() => hacer(() => mandarPruebaDeAvisosAction(), "Prueba enviada: revisa tu WhatsApp")}
        >
          {ocupado ? <Loader2 className="animate-spin" /> : <Send />}
          Mandar prueba
        </Button>
      </div>
      {!avisos.telefono ? <p className="text-xs text-amber-600">Falta tu número: sin él no sale ningún aviso.</p> : null}

      <div className="space-y-1 border-t pt-2">
        <p className="text-xs font-medium">Últimos avisos</p>
        {avisos.ultimos.length ? (
          <ul className="space-y-1 text-xs">
            {avisos.ultimos.slice(0, 10).map((aviso) => (
              <li key={`${aviso.cuando}-${aviso.tipo}`} className="flex gap-2">
                <span className="shrink-0 text-muted-foreground">{FECHA.format(new Date(aviso.cuando))}</span>
                <span>
                  <span className={aviso.salio ? "" : "text-amber-600"}>{aviso.salio ? "Salió" : `No salió: ${aviso.motivo ?? "sin motivo"}`}</span>
                  {" — "}
                  {aviso.texto.split("\n")[0]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Todavía no ha salido ninguno.</p>
        )}
      </div>
    </section>
  );
}
