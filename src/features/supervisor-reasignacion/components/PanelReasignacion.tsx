import { guardarAjustesDeReasignacionAction } from "@/app/actions/supervisor-reasignacion-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

import type { ConfigReasignacion } from "../dominio/reglas";
import type { RegistroDelDia } from "../servicios/registro";

const DIAS = [
  { n: 1, nombre: "Lun" },
  { n: 2, nombre: "Mar" },
  { n: 3, nombre: "Mié" },
  { n: 4, nombre: "Jue" },
  { n: 5, nombre: "Vie" },
  { n: 6, nombre: "Sáb" },
  { n: 0, nombre: "Dom" },
];

const NOMBRE_DEL_TIPO: Record<string, string> = {
  AVISO: "Aviso a los minutos sin respuesta",
  BOT_PIDIO_ASESORA: "El bot pidió asesora",
  CALIENTE_24H: "Caliente sin mensaje",
  REASIGNACION: "Chat reasignado",
  SIN_CANDIDATA: "Sin otra asesora disponible",
  ESCALADA_DUENO: "Tampoco contestó la nueva",
};

function hora(fecha: Date): string {
  return fecha.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" });
}

/**
 * Ajustes del vigilante de reasignación (solo el dueño los edita), la lista de hoy y el conteo por asesora.
 * `nombres`: id de usuario → nombre. `sinNumero`: asesoras sin número de avisos en Equipo.
 */
export function PanelReasignacionView({
  config,
  registro,
  nombres,
  sinNumero,
  puedeEditar,
}: {
  config: ConfigReasignacion;
  registro: RegistroDelDia | null;
  nombres: Record<string, string>;
  sinNumero: string[];
  puedeEditar: boolean;
}) {
  const nombre = (id: string | null) => (id ? nombres[id] || "Asesora" : "—");
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Avisos y reasignación de chats</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Si el cliente escribió último y la asesora no contesta, el Supervisor le avisa por WhatsApp (línea Admin) y, pasado el
          segundo tiempo, pasa el chat a la asesora con menos chats esperando. Solo cuenta el horario laboral. Nunca le escribe al cliente.
        </p>

        {puedeEditar ? (
          <form action={guardarAjustesDeReasignacionAction} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="avisosActivo">Avisos por WhatsApp</Label>
                <NativeSelect id="avisosActivo" name="avisosActivo" defaultValue={config.avisosActivo ? "on" : "off"}>
                  <NativeSelectOption value="off">Apagados</NativeSelectOption>
                  <NativeSelectOption value="on">Prendidos</NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="reasignacionActiva">Reasignación automática</Label>
                <NativeSelect id="reasignacionActiva" name="reasignacionActiva" defaultValue={config.reasignacionActiva ? "on" : "off"}>
                  <NativeSelectOption value="off">Apagada</NativeSelectOption>
                  <NativeSelectOption value="on">Prendida</NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="avisoMin">Minutos para avisar</Label>
                <Input id="avisoMin" name="avisoMin" type="number" min={1} max={600} defaultValue={config.avisoMin} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reasignarMin">Minutos para reasignar</Label>
                <Input id="reasignarMin" name="reasignarMin" type="number" min={1} max={1440} defaultValue={config.reasignarMin} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="calienteHoras">Horas para el Caliente sin mensaje</Label>
                <Input id="calienteHoras" name="calienteHoras" type="number" min={1} max={168} defaultValue={config.calienteHoras} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="canalId">Línea de los avisos (id, debe ser administrativa)</Label>
                <Input id="canalId" name="canalId" defaultValue={config.canalId} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="desde">Abre (hora, 0–23)</Label>
                <Input id="desde" name="desde" type="number" min={0} max={23} defaultValue={config.horario.desde} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="hasta">Cierra (hora, 1–24)</Label>
                <Input id="hasta" name="hasta" type="number" min={1} max={24} defaultValue={config.horario.hasta} />
              </div>
            </div>
            <fieldset className="flex flex-wrap gap-3">
              <legend className="mb-1 text-xs text-muted-foreground">Días de trabajo</legend>
              {DIAS.map((dia) => (
                <label key={dia.n} className="flex items-center gap-1 text-xs">
                  <input type="checkbox" name="dias" value={dia.n} defaultChecked={config.horario.dias.includes(dia.n)} />
                  {dia.nombre}
                </label>
              ))}
            </fieldset>
            <Button type="submit" size="sm">
              Guardar ajustes
            </Button>
          </form>
        ) : (
          <p className="text-muted-foreground">
            Avisos {config.avisosActivo ? "prendidos" : "apagados"} · reasignación {config.reasignacionActiva ? "prendida" : "apagada"} ·
            avisa a los {config.avisoMin} min, reasigna a los {config.reasignarMin} min.
          </p>
        )}

        {sinNumero.length ? (
          <p className="text-xs text-amber-600">Sin número de avisos en Equipo (no les llega el WhatsApp): {sinNumero.join(", ")}.</p>
        ) : null}

        {registro ? (
          <div className="space-y-2">
            <p className="font-medium">Hoy ({registro.dia}): {registro.total} registro(s)</p>
            {registro.conteo.length ? (
              <ul className="space-y-0.5 text-xs">
                {registro.conteo.map((c) => (
                  <li key={c.asesoraId}>
                    <span className="font-medium">{nombre(c.asesoraId)}</span>: {c.avisos} aviso(s), {c.calientes24h} caliente(s) sin mensaje,{" "}
                    {c.reasignadosDeEllaA} chat(s) que perdió, {c.recibidos} que recibió
                    {c.whatsappFallidos ? `, ${c.whatsappFallidos} WhatsApp sin salir` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Hoy no ha pasado nada.</p>
            )}
            {registro.avisos.length ? (
              <ul className="space-y-1">
                {registro.avisos.map((a) => (
                  <li key={a.id} className="rounded-md border border-border bg-background/60 px-3 py-1.5 text-xs">
                    <span className="font-medium">{NOMBRE_DEL_TIPO[a.tipo] ?? a.tipo}</span> · {hora(a.creadoEn)} · {nombre(a.asesoraId)}
                    {a.asesoraNuevaId ? ` → ${nombre(a.asesoraNuevaId)}` : ""} · {a.minutosEsperando} min · chat {a.conversationId}
                    {a.whatsappEnviado ? " · WhatsApp enviado" : a.error ? ` · ${a.error}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
