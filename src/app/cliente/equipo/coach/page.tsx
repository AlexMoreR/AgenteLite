import type { Metadata } from "next";
import Link from "next/link";

import { generarCoachAhoraAction, guardarCoachNocturnoAction } from "@/app/actions/coach-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ParteDeAsesoraCard } from "@/features/coach/components/ParteDeAsesoraCard";
import { ResumenDelEquipoCard } from "@/features/coach/components/ResumenDelEquipoCard";
import { diaEnBogota, esDiaValido } from "@/features/coach/reglas";
import { coachNocturnoActivo } from "@/features/coach/servicios/generar-coach";
import { leerInformeDelCoach } from "@/features/coach/servicios/leer-coach";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function moverDia(dia: string, dias: number) {
  const fecha = new Date(`${dia}T12:00:00.000Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/**
 * COACH DE VENTAS. Quien supervisa (dueño, administradores, supervisoras) ve el informe completo
 * del equipo; cada asesora ve SOLO su parte y sus pendientes, sin el resumen ni a las demas.
 * El dueño puede generar el informe de un dia ("Generar ahora") y prender la corrida nocturna.
 */
export default async function CoachDeVentasPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("crm");
  const params = await searchParams;
  const hoy = diaEnBogota(new Date());
  const pedido = typeof params.dia === "string" ? params.dia : "";
  // Por defecto el ultimo dia cerrado: el coach corre a las 23:30.
  const dia = esDiaValido(pedido) && pedido <= hoy ? pedido : moverDia(hoy, -1);
  const generando = params.generando === "1";

  const supervisa = await puedeSupervisar(access);
  const esDueno = access.isOwner || access.role === "ADMIN";
  const [informe, nocturno] = await Promise.all([
    leerInformeDelCoach(access.workspaceId, dia, supervisa ? {} : { soloUserId: access.userId }),
    esDueno ? coachNocturnoActivo(access.workspaceId) : Promise.resolve(false),
  ]);

  const asesoraPedida = supervisa && typeof params.asesora === "string" ? params.asesora : "";
  const partes = informe
    ? informe.asesoras.filter((parte) => !asesoraPedida || parte.userId === asesoraPedida)
    : [];
  const enlace = (d: string, asesora = asesoraPedida) =>
    `/cliente/equipo/coach?dia=${d}${asesora ? `&asesora=${encodeURIComponent(asesora)}` : ""}`;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Coach de ventas</h1>
        <p className="text-sm text-muted-foreground">
          {supervisa
            ? "Lo que pasó en los chats del día: aciertos, errores, puntaje por asesora y a quién escribir mañana."
            : "Tu día en los chats: lo que hiciste bien, lo que puedes mejorar y a quién escribir mañana. Solo lo ves tú."}
        </p>
      </div>

      <Card size="sm">
        <CardContent className="flex flex-wrap items-center gap-2">
          <Link
            href={enlace(moverDia(dia, -1))}
            className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
          >
            Día anterior
          </Link>
          <form method="get" action="/cliente/equipo/coach" className="flex items-center gap-1.5">
            <Input type="date" name="dia" defaultValue={dia} max={hoy} className="h-8 w-40" aria-label="Día" />
            {asesoraPedida ? <input type="hidden" name="asesora" value={asesoraPedida} /> : null}
            <Button type="submit" size="sm" variant="outline">
              Ver
            </Button>
          </form>
          {dia < hoy ? (
            <Link
              href={enlace(moverDia(dia, 1))}
              className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            >
              Día siguiente
            </Link>
          ) : null}
        </CardContent>
      </Card>

      {esDueno ? (
        <Card size="sm">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm">Generar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <form action={generarCoachAhoraAction}>
                <input type="hidden" name="dia" value={dia} />
                <Button type="submit" size="sm">
                  Generar ahora ({dia})
                </Button>
              </form>
              <form action={guardarCoachNocturnoAction}>
                <input type="hidden" name="dia" value={dia} />
                <input type="hidden" name="activo" value={nocturno ? "0" : "1"} />
                <Button type="submit" size="sm" variant="outline">
                  {nocturno ? "Apagar el coach de cada noche" : "Prender el coach de cada noche"}
                </Button>
              </form>
            </div>
            <p className="text-xs text-muted-foreground">
              {nocturno
                ? "Corre solo todos los días a las 11:30 p. m. (hora de Colombia) sobre los chats de ese día."
                : "Apagado: solo corre cuando tocas “Generar ahora”."}{" "}
              No envía nada a los clientes ni cambia el bot.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {informe?.colgado ? (
        <p className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">
          El informe del {dia} quedó a medias (el servidor se reinició mientras se generaba).
          {esDueno ? " Toca «Generar ahora» para rehacerlo." : " Pídele al dueño que lo vuelva a generar."}
        </p>
      ) : generando || informe?.estado === "EN_CURSO" ? (
        <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
          Generando el informe del {dia}. Tarda uno o dos minutos:{" "}
          <Link href={enlace(dia)} className="font-medium underline">
            recargar
          </Link>
          .
        </p>
      ) : null}
      {informe?.estado === "ERROR" ? (
        <p className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">
          El último intento falló{informe.error && supervisa ? `: ${informe.error}` : ""}.
        </p>
      ) : null}

      {!informe ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Todavía no hay informe del coach para este día.</p>
      ) : informe.estado === "LISTO" ? (
        <>
          {supervisa ? <ResumenDelEquipoCard informe={informe} /> : null}

          {supervisa && informe.asesoras.length > 1 ? (
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Link
                href={enlace(dia, "")}
                className={`rounded-full px-3 py-1 font-medium ${asesoraPedida ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"}`}
              >
                Todas
              </Link>
              {informe.asesoras.map((parte) => (
                <Link
                  key={parte.userId}
                  href={enlace(dia, parte.userId)}
                  className={`rounded-full px-3 py-1 font-medium ${asesoraPedida === parte.userId ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                >
                  {parte.nombre}
                </Link>
              ))}
            </div>
          ) : null}

          {partes.length ? (
            partes.map((parte) => <ParteDeAsesoraCard key={parte.userId} parte={parte} />)
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {supervisa ? "Ninguna asesora tuvo chats ese día." : "Ese día no tuviste chats para revisar."}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
