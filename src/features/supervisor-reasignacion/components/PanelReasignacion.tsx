"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { guardarAjustesDeReasignacionAction } from "@/app/actions/supervisor-reasignacion-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";

import type { ConfigReasignacion } from "../dominio/reglas";
import type { DatosDeLaTarjeta } from "../servicios/config";
import type { RegistroDelDia } from "../servicios/registro";

const DOMINIO = "https://app.aizenbot.com";

/**
 * La tarjeta de la pantalla del Supervisor (solo el dueño): los ajustes de los avisos por WhatsApp
 * y de la reasignación automática, la lista de hoy y el conteo del día por asesora.
 */

const DIAS = [
  { n: 1, corto: "Lu" },
  { n: 2, corto: "Ma" },
  { n: 3, corto: "Mi" },
  { n: 4, corto: "Ju" },
  { n: 5, corto: "Vi" },
  { n: 6, corto: "Sá" },
  { n: 0, corto: "Do" },
];

const ETIQUETA_DEL_TIPO: Record<string, string> = {
  AVISO: "Aviso sin respuesta",
  REASIGNACION: "Reasignado",
  CALIENTE_24H: "Caliente sin mensaje",
  BOT_PIDIO_ASESORA: "El bot pidió asesora",
  SIN_CANDIDATA: "Al dueño: no se pudo pasar",
  NO_REASIGNADO: "No se reasignó (ya respondió)",
  RECORDATORIO: "Recordatorio (ya había respondido)",
  SIN_RESPUESTA_2H: "Al Supervisor: sin respuesta",
};

const SUBTITULO = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

function hora(fecha: Date): string {
  return new Date(fecha).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" });
}

function Minutos({ etiqueta, valor, onChange, min, max, sufijo }: { etiqueta: string; valor: number; onChange: (n: number) => void; min: number; max: number; sufijo: string }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[13px] text-foreground">
      <span>{etiqueta}</span>
      <span className="flex items-center gap-1">
        <Input type="number" min={min} max={max} value={valor} onChange={(e) => onChange(Number(e.target.value))} className="h-8 w-20 text-right" />
        <span className="text-[11px] text-muted-foreground">{sufijo}</span>
      </span>
    </label>
  );
}

export function PanelReasignacion({ datos, registro }: { datos: DatosDeLaTarjeta; registro: RegistroDelDia | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [config, setConfig] = useState<ConfigReasignacion>(datos.config);
  const cambiar = (parcial: Partial<ConfigReasignacion>) => setConfig((actual) => ({ ...actual, ...parcial }));
  const cambiarHorario = (parcial: Partial<ConfigReasignacion["horario"]>) => setConfig((actual) => ({ ...actual, horario: { ...actual.horario, ...parcial } }));

  const guardar = (siguiente: ConfigReasignacion, previo: ConfigReasignacion) => {
    startTransition(async () => {
      const respuesta = await guardarAjustesDeReasignacionAction(siguiente);
      if ("error" in respuesta) {
        toast.error(respuesta.error);
        // Solo se deshace lo que se intentó guardar (lo que se estaba editando queda en pantalla).
        setConfig(previo);
        return;
      }
      setConfig(respuesta.config);
      toast.success("Ajustes guardados");
      router.refresh();
    });
  };
  // Los interruptores se guardan al tocarlos; los tiempos y el horario, con el botón.
  const interruptor = (clave: "avisosActivos" | "reasignacionActiva", valor: boolean) => {
    const siguiente = { ...config, [clave]: valor };
    setConfig(siguiente);
    guardar(siguiente, config);
  };
  const lineaGuardada = datos.lineasAdmin.some((l) => l.id === config.canalId);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Avisos por WhatsApp y reasignación de chats</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className={SUBTITULO}>Interruptores</p>
            <label className="flex items-center justify-between gap-2 text-[13px] text-foreground">
              <span>
                Avisos a la asesora <span className="text-[11px] text-muted-foreground">(sin respuesta, Caliente, bot pidió asesora)</span>
              </span>
              <Switch checked={config.avisosActivos} disabled={isPending} onCheckedChange={(v) => interruptor("avisosActivos", v)} />
            </label>
            <label className="flex items-center justify-between gap-2 text-[13px] text-foreground">
              <span>Reasignación automática</span>
              <Switch checked={config.reasignacionActiva} disabled={isPending} onCheckedChange={(v) => interruptor("reasignacionActiva", v)} />
            </label>
            <p className="text-[11px] text-muted-foreground">
              Con los avisos prendidos, el Supervisor accionable deja de mandar su WhatsApp de &quot;asignado sin respuesta&quot; y &quot;caliente
              esperando&quot; (sigue el push y la escalada a ti).
            </p>
          </div>

          <div className="space-y-2 rounded-md border border-border p-3">
            <p className={SUBTITULO}>Tiempos (minutos laborales)</p>
            <Minutos etiqueta="Aviso sin respuesta" valor={config.avisoMin} min={1} max={240} sufijo="min" onChange={(n) => cambiar({ avisoMin: n })} />
            <Minutos etiqueta="Reasignar si nunca le escribió al cliente" valor={config.reasignarMin} min={2} max={600} sufijo="min" onChange={(n) => cambiar({ reasignarMin: n })} />
            <Minutos etiqueta="Recordatorio si ya había respondido" valor={config.recordatorioMin} min={1} max={600} sufijo="min" onChange={(n) => cambiar({ recordatorioMin: n })} />
            <Minutos etiqueta="Aviso al Supervisor si ya había respondido" valor={config.avisoSupervisorMin} min={2} max={1440} sufijo="min" onChange={(n) => cambiar({ avisoSupervisorMin: n })} />
            <Minutos etiqueta="Duración de «En espera»" valor={config.esperaHoras} min={1} max={24} sufijo="h" onChange={(n) => cambiar({ esperaHoras: n })} />
            <Minutos etiqueta="Caliente sin mensaje de ella" valor={config.calienteHoras} min={1} max={168} sufijo="h" onChange={(n) => cambiar({ calienteHoras: n })} />
          </div>

          <div className="space-y-2 rounded-md border border-border p-3">
            <p className={SUBTITULO}>Horario laboral (Bogotá)</p>
            <div className="flex flex-wrap gap-3">
              {DIAS.map((dia) => (
                <label key={dia.n} className="flex items-center gap-1 text-[13px]">
                  <Checkbox
                    checked={config.horario.dias.includes(dia.n)}
                    onCheckedChange={(v) =>
                      cambiarHorario({ dias: v ? [...config.horario.dias, dia.n].sort() : config.horario.dias.filter((d) => d !== dia.n) })
                    }
                  />
                  {dia.corto}
                </label>
              ))}
            </div>
            <Minutos etiqueta="Abre" valor={config.horario.desde} min={0} max={23} sufijo="h" onChange={(n) => cambiarHorario({ desde: n })} />
            <Minutos etiqueta="Cierra" valor={config.horario.hasta} min={1} max={24} sufijo="h" onChange={(n) => cambiarHorario({ hasta: n })} />
          </div>

          <div className="space-y-2 rounded-md border border-border p-3">
            <p className={SUBTITULO}>Línea de los avisos</p>
            <NativeSelect value={config.canalId} onChange={(e) => cambiar({ canalId: e.target.value })} className="w-full">
              {!lineaGuardada ? <NativeSelectOption value={config.canalId}>{config.canalId} (no es una línea administrativa)</NativeSelectOption> : null}
              {datos.lineasAdmin.map((l) => (
                <NativeSelectOption key={l.id} value={l.id}>
                  {l.nombre}
                  {l.conectada ? "" : " (sin conectar)"}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p className="text-[11px] text-muted-foreground">Solo líneas administrativas. Los avisos van al número de cada persona en Mi empresa → Equipo.</p>
            {datos.sinNumero.length ? (
              <p className="text-[12px] text-amber-700 dark:text-amber-400">Sin número de avisos (no les llega el WhatsApp): {datos.sinNumero.join(", ")}</p>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end">
          <Button size="sm" disabled={isPending} onClick={() => guardar(config, config)}>
            Guardar tiempos y horario
          </Button>
        </div>

        {registro ? (
          <div className="space-y-3">
            <p className={SUBTITULO}>Hoy · conteo por asesora</p>
            {registro.conteo.length ? (
              <ul className="space-y-1 text-[13px]">
                {registro.conteo.map((c) => (
                  <li key={c.asesoraId}>
                    <span className="font-medium">{c.asesora}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {c.avisos + c.botPidioAsesora} avisos · {c.caliente24h} Caliente · {c.recordatorios} recordatorios · {c.noReasignados} no reasignados · le quitaron {c.reasignadosLeQuitaron} · recibió {c.reasignadosRecibio}
                      {c.sinCandidata ? ` · ${c.sinCandidata} al dueño` : ""}
                      {c.whatsappFallidos ? ` · ${c.whatsappFallidos} WhatsApp fallidos` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">Nada todavía hoy.</p>
            )}
            {registro.filas.length ? (
              <>
                <p className={SUBTITULO}>Hoy · registro</p>
                <ul className="divide-y divide-border rounded-md border border-border text-[13px]">
                  {registro.filas.slice(0, 100).map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span>
                        <span className="text-muted-foreground">{hora(f.creadoEn)} · </span>
                        <span className="font-medium">{ETIQUETA_DEL_TIPO[f.tipo] ?? f.tipo}</span> · {f.asesora}
                        {f.asesoraNueva ? ` → ${f.asesoraNueva}` : ""} · {f.minutosEsperando} min
                        {f.whatsappEnviado ? "" : <span className="text-destructive"> · WhatsApp no salió{f.error ? `: ${f.error}` : ""}</span>}
                      </span>
                      <a
                        className="text-primary underline-offset-2 hover:underline"
                        href={f.numeroDelChat ? `${DOMINIO}/c/${f.numeroDelChat}` : `/cliente/chats?chatKey=${encodeURIComponent(`agent:${f.conversationId}`)}&assigned=all`}
                      >
                        Ver chat
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
