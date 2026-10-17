import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { marcarAccionDelCoachAction } from "@/app/actions/coach-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FiltroDeMetrica, FiltroDeRango } from "@/features/coach/components/linea/FiltrosDelCoach";
import { GraficoDelCoach } from "@/features/coach/components/linea/GraficoDelCoach";
import { TarjetaDeAccionCoach } from "@/features/coach/components/acciones/TarjetaDeAccionCoach";
import { armarAccionesDeHoy, diaCorto, moverDia, type TarjetaDeAccion } from "@/features/coach/dominio/acciones-de-hoy";
import { numerosDeLaParte } from "@/features/coach/dominio/chats-cerrados";
import {
  armarSerie,
  asesorasDe,
  metricaDe,
  resolverRango,
  resumenDelRango,
  textoDelRango,
  type Rango,
} from "@/features/coach/dominio/linea-de-tiempo";
import { diaEnBogota, esDiaValido } from "@/features/coach/reglas";
import { conversacionesPorNumero, leerEstadosDeAcciones } from "@/features/coach/servicios/acciones-coach";
import { leerInformeDelCoach } from "@/features/coach/servicios/leer-coach";
import { leerDiasDelCoach } from "@/features/coach/servicios/linea-coach";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ userId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const coma = (n: number | null) => (n === null ? "—" : n.toString().replace(".", ","));

/**
 * La tarjeta completa del Coach de UN dia para esta asesora (lo mismo que "Acciones de hoy": habilidad,
 * por que, que hacer, accion, meta, pendientes sin chats cerrados, evidencia con Abrir chat y
 * diagnostico). Quien supervisa lee el informe entero (para separar lo del sistema, como antes);
 * la asesora lee solo su parte.
 */
async function tarjetaDelDia(workspaceId: string, dia: string, userId: string, supervisa: boolean): Promise<TarjetaDeAccion | null> {
  const hoy = diaEnBogota(new Date());
  const lectura = supervisa ? {} : { soloUserId: userId };
  const siguienteDia = moverDia(dia, 1);
  const [informe, siguiente] = await Promise.all([
    leerInformeDelCoach(workspaceId, dia, lectura),
    siguienteDia <= hoy
      ? leerInformeDelCoach(workspaceId, siguienteDia, { ...lectura, quitarCerrados: false }).catch(() => null)
      : Promise.resolve(null),
  ]);
  if (!informe || informe.estado !== "LISTO") return null;
  const parte = informe.asesoras.find((p) => p.userId === userId);
  if (!parte) return null;
  const [mapa, estados] = await Promise.all([
    conversacionesPorNumero(workspaceId, numerosDeLaParte(parte)).catch(() => ({})),
    leerEstadosDeAcciones(workspaceId, dia, [userId]).catch(() => ({})),
  ]);
  const acciones = armarAccionesDeHoy(
    { dia, resumenEquipo: informe.resumenEquipo, asesoras: [parte] },
    { conversacionPorNumero: mapa, estados, siguiente: siguiente?.estado === "LISTO" ? siguiente : null },
  );
  return acciones.tarjetas[0] ?? null;
}

/** Enlace a esta misma seccion con otro rango o dia. */
function enlace(userId: string, rango: Rango, cambios: { dia?: string | null; metrica?: string | null } = {}) {
  const q = new URLSearchParams();
  q.set("rango", rango.tipo);
  if (rango.tipo === "custom") {
    q.set("desde", rango.desde);
    q.set("hasta", rango.hasta);
  }
  if (cambios.metrica) q.set("metrica", cambios.metrica);
  if (cambios.dia) q.set("dia", cambios.dia);
  return `/cliente/equipo/coach/asesora/${encodeURIComponent(userId)}?${q.toString()}`;
}

/**
 * SECCION DE UNA ASESORA (/cliente/equipo/coach/asesora/<userId>). Abre en AYER: su tarjeta
 * completa del Coach. Con Semana / Mes / Personalizado: su linea en esas fechas, cuantos dias
 * cumplio la meta, los errores que mas repite y la lista de dias (tocar un dia abre su tarjeta).
 *
 * Una asesora solo ve su propia seccion; quien supervisa ve la de cualquiera.
 */
export default async function SeccionDeAsesoraPage({ params, searchParams }: PageProps) {
  const [{ userId: crudo }, consulta] = await Promise.all([params, searchParams]);
  const userId = decodeURIComponent(crudo);
  const access = await requireClientWorkspaceAccess("crm");
  const supervisa = await puedeSupervisar(access);
  if (!supervisa && userId !== access.userId) redirect(`/cliente/equipo/coach/asesora/${encodeURIComponent(access.userId)}`);

  const hoy = diaEnBogota(new Date());
  const ayer = moverDia(hoy, -1);
  const rango = resolverRango({ rango: consulta.rango, desde: consulta.desde, hasta: consulta.hasta }, hoy, "ayer");
  const metrica = metricaDe(consulta.metrica);
  const diaPedido = texto(consulta.dia);
  // Un dia: el que se toco en la lista, o el del rango "Ayer".
  const dia = esDiaValido(diaPedido) && diaPedido <= hoy ? diaPedido : rango.tipo === "ayer" ? rango.hasta : null;

  const [tarjeta, dias, ultima] = await Promise.all([
    dia ? tarjetaDelDia(access.workspaceId, dia, userId, supervisa) : Promise.resolve(null),
    rango.tipo !== "ayer" ? leerDiasDelCoach(access.workspaceId, rango.desde, rango.hasta, { soloUserId: userId }) : Promise.resolve([]),
    // El nombre: de su ultimo informe en ESTE negocio (no se lee el usuario de otro lado).
    prisma.coachAsesora.findFirst({
      where: { workspaceId: access.workspaceId, userId },
      orderBy: { createdAt: "desc" },
      select: { nombre: true },
    }),
  ]);
  const nombre = tarjeta?.nombre ?? ultima?.nombre ?? "Asesora";
  const puedeMarcar = supervisa || userId === access.userId;

  const actuales: Record<string, string> = {};
  for (const k of ["rango", "desde", "hasta", "metrica"]) {
    const v = texto(consulta[k]);
    if (v) actuales[k] = v;
  }
  const destino = { base: `/cliente/equipo/coach/asesora/${encodeURIComponent(userId)}`, actuales };

  const resumen = rango.tipo !== "ayer" ? resumenDelRango(dias, userId, rango) : null;
  const asesoras = asesorasDe(dias);
  const filas = armarSerie(dias, rango, metrica.clave, asesoras);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5">
      <Button asChild variant="ghost" className="-ml-2 h-11 px-2">
        <Link href="/cliente/equipo/coach">‹ Coach</Link>
      </Button>
      <h1 className="text-lg font-semibold">{nombre}</h1>

      <FiltroDeRango {...destino} rango={rango} opciones={["ayer", "semana", "mes"]} hoy={hoy} />

      {dia ? (
        <section aria-label={`Coach del ${dia}`} className="space-y-2">
          {rango.tipo !== "ayer" ? (
            <Link href={enlace(userId, rango, { metrica: actuales.metrica })} className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
              ‹ Volver a {textoDelRango(rango)}
            </Link>
          ) : null}
          {tarjeta ? (
            <TarjetaDeAccionCoach
              tarjeta={tarjeta}
              dia={dia}
              rotuloDelDia={dia === ayer ? "Ayer" : diaCorto(dia)}
              accionDeEstado={puedeMarcar ? marcarAccionDelCoachAction : undefined}
            />
          ) : (
            <p className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">
              No hay informe del Coach {dia === ayer ? "de ayer" : `del ${diaCorto(dia)}`} para {nombre}.
            </p>
          )}
        </section>
      ) : null}

      {resumen && !dia ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Cómo va</CardTitle>
              <CardDescription>
                {metrica.nombre} · {textoDelRango(rango)}. {metrica.ayuda}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <FiltroDeMetrica {...destino} metrica={metrica.clave} />
              <GraficoDelCoach filas={filas} asesoras={asesoras} metrica={metrica} />
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Resumen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-muted px-3 py-2">
                  <p className="text-xs text-muted-foreground">Días con informe</p>
                  <p className="text-xl font-semibold tabular-nums">{resumen.diasConInforme}</p>
                </div>
                <div className="rounded-lg bg-muted px-3 py-2">
                  <p className="text-xs text-muted-foreground">Metas cumplidas</p>
                  <p className="text-xl font-semibold tabular-nums">
                    {resumen.metasCumplidas} de {resumen.metasMedidas}
                  </p>
                </div>
              </div>
              <div>
                <p className="mb-1 text-sm font-medium">Errores que más repite</p>
                {resumen.erroresRepetidos.length ? (
                  <ul className="space-y-1 text-sm">
                    {resumen.erroresRepetidos.map((e) => (
                      <li key={e.tipo} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">{e.nombre}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {e.dias} {e.dias === 1 ? "día" : "días"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Sin errores guardados en estas fechas.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Días</CardTitle>
              <CardDescription>Toca un día para ver su tarjeta del Coach.</CardDescription>
            </CardHeader>
            <CardContent>
              {resumen.dias.length ? (
                <ul className="divide-y divide-border">
                  {resumen.dias.map((d) => (
                    <li key={d.dia}>
                      <Link
                        href={enlace(userId, rango, { dia: d.dia, metrica: actuales.metrica })}
                        className="flex min-h-12 items-center gap-3 py-2 hover:bg-muted/50"
                      >
                        <span className="w-14 shrink-0 text-sm font-medium">{diaCorto(d.dia)}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                          {d.habilidad?.nombre ?? "Sin habilidad"}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {metrica.corto}: {coma(d[metrica.clave])}
                        </span>
                        {d.meta ? (
                          <Badge
                            className={
                              d.meta.cumple
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                            }
                          >
                            {d.meta.cumple ? "Cumplió" : "No cumplió"}
                          </Badge>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">No hay informes del Coach en estas fechas.</p>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
