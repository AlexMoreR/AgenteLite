import { guardarAjustesReasignacionAction } from "@/app/actions/supervisor-reasignacion-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

import type { ConfigReasignacion } from "../dominio/reglas";
import type { RegistroDelDia } from "../servicios/registro";

const NOMBRE_DE_TIPO: Record<string, string> = {
  AVISO: "Aviso (sin respuesta)",
  REASIGNACION: "Reasignación",
  CALIENTE_24H: "Caliente 24 h",
  BOT_PIDIO_ASESORA: "El bot pidió asesora",
  SIN_CANDIDATA: "Sin otra asesora",
};

const DIAS = [
  { n: 1, nombre: "Lun" },
  { n: 2, nombre: "Mar" },
  { n: 3, nombre: "Mié" },
  { n: 4, nombre: "Jue" },
  { n: 5, nombre: "Vie" },
  { n: 6, nombre: "Sáb" },
  { n: 0, nombre: "Dom" },
];

const hora = (fecha: Date) => fecha.toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" });

function Campo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-muted-foreground">{titulo}</span>
      {children}
    </label>
  );
}

/**
 * Avisos por WhatsApp y reasignación (pantalla del Supervisor): ajustes, lista de hoy y conteo por
 * asesora. `puedeEditar` = dueño o administrador; la supervisora solo ve el registro.
 */
export function PanelReasignacion({
  config,
  registro,
  lineas,
  sinNumero,
  puedeEditar,
}: {
  config: ConfigReasignacion;
  registro: RegistroDelDia | null;
  lineas: Array<{ id: string; nombre: string; esAdmin: boolean }>;
  /** Asesoras (con chats) que no tienen número de avisos: no reciben el WhatsApp. */
  sinNumero: string[];
  puedeEditar: boolean;
}) {
  const estado = (activo: boolean) => (activo ? "prendido" : "apagado");
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Avisos por WhatsApp y reasignación de chats</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Avisos {estado(config.avisosActivo)} · reasignación {estado(config.reasignacionActiva)}. Cuenta solo el horario laboral. Los avisos van al
          WhatsApp personal de la asesora desde la línea administrativa; al cliente nunca se le escribe.
        </p>
        {sinNumero.length ? (
          <p className="rounded-md border border-amber-500/60 bg-amber-500/5 px-3 py-2 text-xs">
            Sin número de avisos (Mi empresa → Equipo), no reciben el WhatsApp: {sinNumero.join(", ")}.
          </p>
        ) : null}

        {puedeEditar ? (
          <form action={guardarAjustesReasignacionAction} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Campo titulo="Avisos por WhatsApp">
                <NativeSelect name="avisosActivo" defaultValue={config.avisosActivo ? "si" : "no"}>
                  <NativeSelectOption value="no">Apagado</NativeSelectOption>
                  <NativeSelectOption value="si">Prendido</NativeSelectOption>
                </NativeSelect>
              </Campo>
              <Campo titulo="Reasignación automática">
                <NativeSelect name="reasignacionActiva" defaultValue={config.reasignacionActiva ? "si" : "no"}>
                  <NativeSelectOption value="no">Apagada</NativeSelectOption>
                  <NativeSelectOption value="si">Prendida</NativeSelectOption>
                </NativeSelect>
              </Campo>
              <Campo titulo="Aviso a los (min sin respuesta)">
                <Input type="number" name="minutosAviso" min={1} max={240} defaultValue={config.minutosAviso} />
              </Campo>
              <Campo titulo="Reasignar a los (min sin respuesta)">
                <Input type="number" name="minutosReasignacion" min={2} max={480} defaultValue={config.minutosReasignacion} />
              </Campo>
              <Campo titulo="Caliente sin mensaje (horas)">
                <Input type="number" name="horasCaliente" min={1} max={168} defaultValue={config.horasCaliente} />
              </Campo>
              <Campo titulo="Abre (hora)">
                <Input type="number" name="desde" min={0} max={23} defaultValue={config.horario.desde} />
              </Campo>
              <Campo titulo="Cierra (hora)">
                <Input type="number" name="hasta" min={1} max={24} defaultValue={config.horario.hasta} />
              </Campo>
              <Campo titulo="Línea desde la que salen los avisos">
                <NativeSelect name="canalId" defaultValue={config.canalId}>
                  {lineas.map((l) => (
                    <NativeSelectOption key={l.id} value={l.id}>
                      {l.nombre}
                      {l.esAdmin ? "" : " (no es administrativa: no enviará)"}
                    </NativeSelectOption>
                  ))}
                  {lineas.some((l) => l.id === config.canalId) ? null : <NativeSelectOption value={config.canalId}>{config.canalId}</NativeSelectOption>}
                </NativeSelect>
              </Campo>
            </div>
            <fieldset className="flex flex-wrap items-center gap-3">
              <legend className="mb-1 text-sm font-medium text-muted-foreground">Días de trabajo</legend>
              {DIAS.map((d) => (
                <label key={d.n} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="dias" value={d.n} defaultChecked={config.horario.dias.includes(d.n)} />
                  {d.nombre}
                </label>
              ))}
            </fieldset>
            <Button type="submit" size="sm">
              Guardar ajustes
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">
            Aviso a los {config.minutosAviso} min · reasignación a los {config.minutosReasignacion} min · Caliente {config.horasCaliente} h · horario{" "}
            {config.horario.desde}:00 a {config.horario.hasta}:00.
          </p>
        )}

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Hoy</p>
          {!registro ? (
            <p className="text-muted-foreground">Todavía no existe el registro (falta la migración).</p>
          ) : (
            <>
              <p className="text-muted-foreground">
                {registro.totales.avisos} aviso(s) · {registro.totales.reasignaciones} reasignación(es)
                {registro.totales.sinCandidata ? ` · ${registro.totales.sinCandidata} sin a quién pasarlo` : ""}
                {registro.totales.whatsappFallidos ? ` · ${registro.totales.whatsappFallidos} sin WhatsApp` : ""}
              </p>
              {registro.conteo.length ? (
                <ul className="space-y-0.5">
                  {registro.conteo.map((c) => (
                    <li key={c.asesoraId}>
                      <span className="font-medium">{c.asesora}</span>: {c.avisos + c.botPidioAsesora} aviso(s), {c.caliente24h} caliente(s) 24 h,{" "}
                      {c.reasignadosDeEllas} chat(s) perdido(s), {c.recibidos} recibido(s)
                    </li>
                  ))}
                </ul>
              ) : null}
              {registro.filas.length ? (
                <ul className="divide-y divide-border/60">
                  {registro.filas.map((f) => (
                    <li key={f.id} className="py-1.5 text-xs">
                      <span className="text-muted-foreground">{hora(f.creadoEn)}</span> · <strong>{NOMBRE_DE_TIPO[f.tipo] ?? f.tipo}</strong> ·{" "}
                      {f.asesora ?? "sin asesora"}
                      {f.asesoraNueva ? ` → ${f.asesoraNueva}` : ""} · chat {f.numero ? `#${f.numero}` : f.conversationId} · {f.minutosEsperando} min
                      {f.tipo === "SIN_CANDIDATA" ? "" : f.whatsappEnviado ? " · WhatsApp enviado" : " · WhatsApp NO salió"}
                      {f.error ? ` (${f.error})` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">Sin avisos ni reasignaciones hoy.</p>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
