import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { guardarAjustesDeReasignacionAction } from "@/app/actions/supervisor-reasignacion-actions";

import { CANAL_ADMIN_POR_DEFECTO, type ConfigReasignacion } from "../dominio/reglas";
import type { RegistroDelDia } from "../servicios/registro";

const NOMBRE_DEL_TIPO: Record<string, string> = {
  AVISO: "Aviso: sin respuesta",
  REASIGNACION: "Reasignación",
  CALIENTE_24H: "Aviso: Caliente 24 h",
  BOT_PIDIO_ASESORA: "Aviso: el bot pidió asesora",
  SIN_CANDIDATA: "Sin quién reciba el chat",
};

const DIAS = [
  { valor: 1, nombre: "Lun" },
  { valor: 2, nombre: "Mar" },
  { valor: 3, nombre: "Mié" },
  { valor: 4, nombre: "Jue" },
  { valor: 5, nombre: "Vie" },
  { valor: 6, nombre: "Sáb" },
  { valor: 0, nombre: "Dom" },
];

const hora = (fecha: Date) => new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" }).format(fecha);

function Campo({ nombre, etiqueta, valor, ayuda }: { nombre: string; etiqueta: string; valor: number | string; ayuda?: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={nombre}>{etiqueta}</Label>
      <Input id={nombre} name={nombre} defaultValue={valor} inputMode="numeric" />
      {ayuda ? <p className="text-xs text-muted-foreground">{ayuda}</p> : null}
    </div>
  );
}

/**
 * Tarjeta del Supervisor de reasignación (solo la ve el dueño o un administrador): los dos interruptores,
 * los tiempos y el horario, y el registro de hoy con el conteo por asesora. Los ajustes se guardan en
 * `supervisor:reasignacion:<negocio>` y el vigilante los lee en cada vuelta, sin tocar código.
 */
export function PanelReasignacion({ config, registro, sinNumero }: { config: ConfigReasignacion; registro: RegistroDelDia | null; sinNumero: string[] }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Avisos y reasignación de chats</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <form action={guardarAjustesDeReasignacionAction} className="space-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Label className="flex items-center gap-2">
              <Checkbox name="avisosActivo" defaultChecked={config.avisosActivo} />
              Avisos por WhatsApp a la asesora
            </Label>
            <Label className="flex items-center gap-2">
              <Checkbox name="reasignacionActiva" defaultChecked={config.reasignacionActiva} />
              Reasignación automática
            </Label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo nombre="minutosAviso" etiqueta="Minutos para avisar" valor={config.minutosAviso} />
            <Campo nombre="minutosReasignacion" etiqueta="Minutos para reasignar" valor={config.minutosReasignacion} ayuda="Cuenta solo horario laboral." />
            <Campo nombre="horasCaliente" etiqueta="Horas del Caliente sin mensaje" valor={config.horasCaliente} />
            <Campo nombre="desde" etiqueta="Abre (hora, 0-23)" valor={config.horario.desde} />
            <Campo nombre="hasta" etiqueta="Cierra (hora, 1-24)" valor={config.horario.hasta} />
            <Campo nombre="canalId" etiqueta="Línea de los avisos" valor={config.canalId ?? ""} ayuda={`Vacío = la Admin (${CANAL_ADMIN_POR_DEFECTO}).`} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {DIAS.map((dia) => (
              <Label key={dia.valor} className="flex items-center gap-1.5">
                <Checkbox name="dias" value={String(dia.valor)} defaultChecked={config.horario.dias.includes(dia.valor)} />
                {dia.nombre}
              </Label>
            ))}
          </div>
          <Button type="submit" size="sm">
            Guardar ajustes
          </Button>
        </form>

        {sinNumero.length ? (
          <p className="rounded-md border border-dashed px-3 py-2 text-muted-foreground">
            Sin número de avisos en Equipo (solo recibirán la notificación al teléfono): {sinNumero.join(", ")}.
          </p>
        ) : null}

        {registro ? (
          <div className="space-y-2">
            <p className="font-semibold">Hoy ({registro.fecha}): {registro.total} {registro.total === 1 ? "registro" : "registros"}</p>
            {registro.conteo.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asesora</TableHead>
                    <TableHead>Avisos</TableHead>
                    <TableHead>Caliente 24 h</TableHead>
                    <TableHead>Bot pidió</TableHead>
                    <TableHead>Perdió chats</TableHead>
                    <TableHead>Recibió chats</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registro.conteo.map((c) => (
                    <TableRow key={c.asesoraId}>
                      <TableCell>{c.asesora}</TableCell>
                      <TableCell>{c.avisos}</TableCell>
                      <TableCell>{c.calientes}</TableCell>
                      <TableCell>{c.botPidioAsesora}</TableCell>
                      <TableCell>{c.chatsPerdidos}</TableCell>
                      <TableCell>{c.chatsRecibidos}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground">Todavía no hay avisos ni reasignaciones hoy.</p>
            )}
            {registro.filas.length ? (
              <ul className="space-y-1">
                {registro.filas.slice(0, 40).map((f) => (
                  <li key={f.id} className="text-xs text-muted-foreground">
                    {hora(f.creadoEn)} · {NOMBRE_DEL_TIPO[f.tipo] ?? f.tipo} · {f.asesora ?? "—"}
                    {f.asesoraNueva ? ` → ${f.asesoraNueva}` : ""}
                    {f.minutosEsperando != null ? ` · ${f.minutosEsperando} min` : ""} · {f.whatsappEnviado ? "WhatsApp enviado" : `WhatsApp no salió${f.error ? ` (${f.error})` : ""}`}
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
