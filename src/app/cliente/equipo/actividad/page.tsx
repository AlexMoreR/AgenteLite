import type { Metadata } from "next";
import Link from "next/link";

import { guardarAsesoraDeRespaldoAction } from "@/app/actions/equipo-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { filtrarEnLinea, leerAsesoraDeRespaldo, periodosEnLinea } from "@/lib/en-linea";
import { formatoDeHoras, minutosEnRango } from "@/lib/en-linea-reglas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { leerActividadDelEquipo } from "@/lib/actividad-del-equipo";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { eventosDePersona, resumenDelEquipo, type TipoDeActividad } from "@/features/actividad/services/actividad";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/*
  El día se cuenta en hora de Colombia, no del servidor (que corre en UTC).

  Sin esto, a las 7 de la noche de acá el servidor ya está en el día siguiente y la pantalla se
  vaciaría sola a mitad de la jornada. Colombia no cambia de hora, así que alcanza con el desfase
  fijo de cinco horas.
*/
const DESFASE_BOGOTA_MS = 5 * 60 * 60_000;

function diaDeHoyEnBogota(): string {
  return new Date(Date.now() - DESFASE_BOGOTA_MS).toISOString().slice(0, 10);
}

function rangoDelDia(dia: string): { desde: Date; hasta: Date } {
  const desde = new Date(`${dia}T00:00:00.000Z`);
  desde.setTime(desde.getTime() + DESFASE_BOGOTA_MS);
  return { desde, hasta: new Date(desde.getTime() + 24 * 3_600_000) };
}

const CUANDO = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  hour: "numeric",
  minute: "2-digit",
});

function haceCuanto(iso: string): string {
  const minutos = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutos) || minutos < 0) return "—";
  if (minutos < 1) return "ahora mismo";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "ayer" : `hace ${dias} días`;
}

const NOMBRE_DEL_TIPO: Record<TipoDeActividad, string> = {
  respuesta: "Respondió",
  asignacion: "Asignación",
  etapa: "Etapa",
  etiqueta: "Etiqueta",
  resuelto: "Resolvió",
  nota: "Nota",
  llamada: "Llamada",
};

export default async function ActividadDelEquipoPage({ searchParams }: PageProps) {
  // Mismo candado que Mi empresa → Equipo: esto es del dueño y de los administradores.
  const access = await requireClientWorkspaceAccess("client_team", { ownerOnly: true });
  const params = await searchParams;

  const dia = typeof params.dia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.dia) ? params.dia : diaDeHoyEnBogota();
  const personaPedida = typeof params.persona === "string" ? params.persona : "";
  const { desde, hasta } = rangoDelDia(dia);

  // "Recibiendo clientes": horas del día elegido y de los 7 días que terminan ese día.
  const desdeLaSemana = new Date(desde.getTime() - 6 * 24 * 3_600_000);
  const [miembros, resumen, latidos, periodos, respaldo] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId: access.workspaceId, isActive: true },
      select: { userId: true, user: { select: { name: true, email: true } } },
    }),
    resumenDelEquipo({ workspaceId: access.workspaceId, desde, hasta }),
    leerActividadDelEquipo(access.workspaceId),
    periodosEnLinea(access.workspaceId, desdeLaSemana, hasta),
    leerAsesoraDeRespaldo(access.workspaceId),
  ]);
  const ahora = new Date();
  const enLineaAhora = await filtrarEnLinea(
    access.workspaceId,
    miembros.map((miembro) => miembro.userId),
    ahora,
  );

  const personas = miembros
    .map((miembro) => ({
      id: miembro.userId,
      nombre: miembro.user?.name?.trim() || miembro.user?.email || "Sin nombre",
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const persona = personas.find((item) => item.id === personaPedida) ?? null;
  const eventos = persona
    ? await eventosDePersona({ workspaceId: access.workspaceId, userId: persona.id, desde, hasta })
    : [];

  const ayer = new Date(`${dia}T12:00:00.000Z`);
  ayer.setDate(ayer.getDate() - 1);
  const manana = new Date(`${dia}T12:00:00.000Z`);
  manana.setDate(manana.getDate() + 1);
  const hoy = diaDeHoyEnBogota();

  const enlaceDelDia = (d: string, p = personaPedida) =>
    `/cliente/equipo/actividad?dia=${d}${p ? `&persona=${encodeURIComponent(p)}` : ""}`;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Actividad del equipo</h1>
        <p className="text-sm text-muted-foreground">
          Qué hizo cada persona y cuándo fue la última vez que tocó la app.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-sm">
            {dia === hoy ? "Hoy" : new Intl.DateTimeFormat("es-CO", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${dia}T12:00:00.000Z`))}
          </CardTitle>
          <div className="flex items-center gap-1.5 text-xs">
            <Link
              href={enlaceDelDia(ayer.toISOString().slice(0, 10))}
              className="rounded-full bg-muted px-3 py-1 font-medium text-muted-foreground transition hover:text-foreground"
            >
              Día anterior
            </Link>
            {dia !== hoy ? (
              <Link
                href={enlaceDelDia(manana.toISOString().slice(0, 10))}
                className="rounded-full bg-muted px-3 py-1 font-medium text-muted-foreground transition hover:text-foreground"
              >
                Día siguiente
              </Link>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Persona</TableHead>
                <TableHead>Última vez</TableHead>
                <TableHead className="text-right">Recibiendo</TableHead>
                <TableHead className="text-right">7 días</TableHead>
                <TableHead className="text-right">Respuestas</TableHead>
                <TableHead className="text-right">Asignó</TableHead>
                <TableHead className="text-right">Etapas</TableHead>
                <TableHead className="text-right">Llamadas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {personas.map((item) => {
                const fila = resumen.get(item.id);
                const latido = latidos[item.id];
                const activa = persona?.id === item.id;
                return (
                  <TableRow key={item.id} className={activa ? "bg-muted/60" : undefined}>
                    <TableCell className="font-medium">
                      <Link href={enlaceDelDia(dia, activa ? "" : item.id)} className="hover:underline">
                        {item.nombre}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {latido ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-foreground">{haceCuanto(latido.cuando)}</span>
                          <span>· {latido.donde}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {latido.dispositivo}
                          </Badge>
                        </span>
                      ) : (
                        // Nadie late hasta que abre la app despues de que esto se instalo.
                        <span>Sin registro todavía</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        {enLineaAhora.has(item.id) ? <span title="Recibiendo clientes ahora">🟢</span> : null}
                        {formatoDeHoras(minutosEnRango(periodos.get(item.id) ?? [], desde, hasta))}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatoDeHoras(minutosEnRango(periodos.get(item.id) ?? [], desdeLaSemana, hasta))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fila?.respuestas ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{fila?.asignaciones ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{fila?.etapas ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{fila?.llamadas ?? 0}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Asesora de respaldo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Cada asesora recibe clientes nuevos mientras tiene la app abierta (🟢 Recibiendo clientes). Si nadie
            está recibiendo, el cliente nuevo le llega a esta persona, con aviso a ella y a los administradores.
            Tiene que trabajar la línea y no estar en pausa de reparto.
          </p>
          <form action={guardarAsesoraDeRespaldoAction} className="flex flex-wrap items-center gap-2">
            <NativeSelect name="respaldo" defaultValue={respaldo ?? ""} aria-label="Asesora de respaldo">
              <NativeSelectOption value="">Nadie (el cliente queda sin asignar)</NativeSelectOption>
              {personas.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.nombre}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button type="submit" size="sm">
              Guardar
            </Button>
          </form>
        </CardContent>
      </Card>

      {persona ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{persona.nombre}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {eventos.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin actividad registrada ese día.
              </p>
            ) : (
              eventos.map((evento, indice) => (
                <div
                  key={`${evento.cuando.toISOString()}-${indice}`}
                  className="flex items-start gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                    {CUANDO.format(evento.cuando)}
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {NOMBRE_DEL_TIPO[evento.tipo]}
                      </Badge>
                      {evento.cliente ? (
                        evento.conversationId ? (
                          <Link
                            href={`/cliente/chats?chatKey=agent:${evento.conversationId}&assigned=all`}
                            className="text-xs font-medium text-foreground hover:underline"
                          >
                            {evento.cliente}
                          </Link>
                        ) : (
                          <span className="text-xs font-medium text-foreground">{evento.cliente}</span>
                        )
                      ) : null}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{evento.texto}</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">Toca una persona para ver qué hizo, uno por uno.</p>
      )}
    </div>
  );
}
