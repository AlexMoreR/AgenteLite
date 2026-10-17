import type { Metadata } from "next";
import Link from "next/link";

import { generarCoachAhoraAction, guardarCoachNocturnoAction, marcarAccionDelCoachAction } from "@/app/actions/coach-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccionesDeHoy } from "@/features/coach/components/acciones/AccionesDeHoy";
import { PanelOperativoCoach } from "@/features/coach/components/acciones/PanelOperativoCoach";
import { Desplegable } from "@/features/coach/components/acciones/piezas";
import { ParteDeAsesoraCard } from "@/features/coach/components/ParteDeAsesoraCard";
import { ResumenDelEquipoCard } from "@/features/coach/components/ResumenDelEquipoCard";
import { armarAccionesDeHoy, diaCorto, refsCitadas } from "@/features/coach/dominio/acciones-de-hoy";
import { diaEnBogota, esDiaValido } from "@/features/coach/reglas";
import { conversacionesPorNumero, leerEstadosDeAcciones } from "@/features/coach/servicios/acciones-coach";
import { coachNocturnoActivo } from "@/features/coach/servicios/generar-coach";
import { leerInformeDelCoach, type InformeDelCoach, type ParteDeAsesora } from "@/features/coach/servicios/leer-coach";
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

/** Todos los numeros de chat que cita el informe (para traducirlos al chat exacto de la bandeja). */
function numerosDelInforme(partes: ParteDeAsesora[], informe: InformeDelCoach): number[] {
  const numeros: Array<number | null> = [];
  for (const p of partes) {
    for (const lista of [p.errores, p.pendientes, p.aciertos, p.resumen?.habilidad?.evidencia ?? []]) {
      for (const item of lista) numeros.push(item.numero);
    }
  }
  for (const f of informe.resumenEquipo?.fallasDelSistema ?? []) numeros.push(...refsCitadas(f.ref));
  return numeros.filter((n): n is number => typeof n === "number");
}

/**
 * INFORME COMPLETO DE UN DIA (/cliente/equipo/coach/informe?dia=…). La primera pagina del Coach
 * ahora es la linea de tiempo (../page.tsx); aca queda el informe entero de un dia, como era antes,
 * con "Generar ahora" y la corrida nocturna. Lo primero es "Acciones de hoy": una tarjeta por asesora con UNA cosa que
 * entrenar, la cifra, la meta y la evidencia debajo (desplegable). Lo que es del sistema va aparte,
 * al Supervisor. El analisis no cambia: sale del informe que guardo el Coach (CoachInforme /
 * CoachAsesora). `?vista=clasica` muestra el informe como era antes.
 *
 * Quien supervisa (dueño, administradores, supervisoras) ve a todo el equipo; cada asesora ve SOLO
 * su tarjeta, sin el resumen ni a las demas. El dueño puede generar el informe de un dia y prender
 * la corrida nocturna.
 */
export default async function CoachDeVentasPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("crm");
  const params = await searchParams;
  const hoy = diaEnBogota(new Date());
  const pedido = typeof params.dia === "string" ? params.dia : "";
  // Por defecto el ultimo dia cerrado: el coach corre a las 23:30.
  const dia = esDiaValido(pedido) && pedido <= hoy ? pedido : moverDia(hoy, -1);
  const generando = params.generando === "1";
  const vistaClasica = params.vista === "clasica";

  const supervisa = await puedeSupervisar(access);
  const esDueno = access.isOwner || access.role === "ADMIN";
  const opcionesDeLectura = supervisa ? {} : { soloUserId: access.userId };
  const diaSiguiente = moverDia(dia, 1);
  const [informe, nocturno, siguiente] = await Promise.all([
    leerInformeDelCoach(access.workspaceId, dia, opcionesDeLectura),
    esDueno ? coachNocturnoActivo(access.workspaceId) : Promise.resolve(false),
    // Para el "cumplido" automatico: la misma metrica en el informe del dia siguiente, tal cual se
    // guardo (sin quitar chats cerrados: la meta se mide con lo que vio el Coach esa noche).
    diaSiguiente <= hoy
      ? leerInformeDelCoach(access.workspaceId, diaSiguiente, { ...opcionesDeLectura, quitarCerrados: false }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const asesoraPedida = supervisa && typeof params.asesora === "string" ? params.asesora : "";
  const partes = informe
    ? informe.asesoras.filter((parte) => !asesoraPedida || parte.userId === asesoraPedida)
    : [];
  const enlace = (d: string, asesora = asesoraPedida, vista = vistaClasica) =>
    `/cliente/equipo/coach/informe?dia=${d}${asesora ? `&asesora=${encodeURIComponent(asesora)}` : ""}${vista ? "&vista=clasica" : ""}`;

  const listo = informe?.estado === "LISTO";
  const [mapa, estados] =
    listo && informe && !vistaClasica
      ? await Promise.all([
          conversacionesPorNumero(access.workspaceId, numerosDelInforme(partes, informe)).catch(() => ({})),
          leerEstadosDeAcciones(
            access.workspaceId,
            dia,
            partes.map((p) => p.userId),
          ).catch(() => ({})),
        ])
      : [{}, {}];
  const acciones =
    listo && informe && !vistaClasica
      ? armarAccionesDeHoy(
          { dia, resumenEquipo: informe.resumenEquipo, asesoras: partes },
          {
            conversacionPorNumero: mapa,
            estados,
            siguiente: siguiente?.estado === "LISTO" ? siguiente : null,
          },
        )
      : null;
  const rotuloDelDia = dia === moverDia(hoy, -1) ? "Ayer" : diaCorto(dia);
  const chip = "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5">
      <Link href="/cliente/equipo/coach" className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
        ‹ Volver al Coach
      </Link>
      {/* La barra de días, en una sola línea (también en el celular). */}
      <nav aria-label="Día del informe" className="flex flex-nowrap items-center gap-1.5">
        <Link
          href={enlace(moverDia(dia, -1))}
          className={`${chip} shrink-0 whitespace-nowrap bg-muted !px-3 text-muted-foreground hover:text-foreground`}
        >
          ‹ {diaCorto(moverDia(dia, -1))}
        </Link>
        <form method="get" action="/cliente/equipo/coach/informe" className="flex min-w-0 flex-1 items-center gap-1.5">
          <Input type="date" name="dia" defaultValue={dia} max={hoy} className="h-11 min-w-0 flex-1 sm:w-40 sm:flex-none" aria-label="Día" />
          {asesoraPedida ? <input type="hidden" name="asesora" value={asesoraPedida} /> : null}
          {vistaClasica ? <input type="hidden" name="vista" value="clasica" /> : null}
          <Button type="submit" variant="outline" className="h-11 shrink-0 px-3">
            Ver
          </Button>
        </form>
        {dia < hoy ? (
          <Link
            href={enlace(diaSiguiente)}
            className={`${chip} shrink-0 whitespace-nowrap bg-muted !px-3 text-muted-foreground hover:text-foreground`}
          >
            {diaCorto(diaSiguiente)} ›
          </Link>
        ) : null}
      </nav>

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
      ) : listo ? (
        <>
          {supervisa && informe.asesoras.length > 1 ? (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <Link
                href={enlace(dia, "")}
                className={`${chip} shrink-0 ${asesoraPedida ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"}`}
              >
                Todas
              </Link>
              {informe.asesoras.map((parte) => (
                <Link
                  key={parte.userId}
                  href={enlace(dia, parte.userId)}
                  className={`${chip} shrink-0 ${asesoraPedida === parte.userId ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                >
                  {parte.nombre}
                </Link>
              ))}
            </div>
          ) : null}

          {acciones ? (
            <>
              <AccionesDeHoy
                acciones={acciones}
                rotuloDelDia={rotuloDelDia}
                puedeMarcar={(userId) => supervisa || userId === access.userId}
                accionDeEstado={marcarAccionDelCoachAction}
              />
              {supervisa ? <PanelOperativoCoach items={acciones.operativo} problemasDelEquipo={acciones.problemasDelEquipo} /> : null}
              {supervisa && informe.resumenEquipo ? (
                <Desplegable className="bg-card" titulo="Resumen del equipo (cifras, motivos, errores por asesora)">
                  <ResumenDelEquipoCard informe={informe} ocultarOperativo />
                </Desplegable>
              ) : null}
            </>
          ) : (
            <>
              {supervisa ? <ResumenDelEquipoCard informe={informe} /> : null}
              {partes.length ? (
                partes.map((parte) => <ParteDeAsesoraCard key={parte.userId} parte={parte} />)
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {supervisa ? "Ninguna asesora tuvo chats ese día." : "Ese día no tuviste chats para revisar."}
                </p>
              )}
            </>
          )}
        </>
      ) : null}

      {esDueno ? (
        <Desplegable className="bg-card" titulo="Generar el informe">
          <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <form action={generarCoachAhoraAction}>
                  <input type="hidden" name="dia" value={dia} />
                  <Button type="submit" className="h-11">
                    Generar ahora ({dia})
                  </Button>
                </form>
                <form action={guardarCoachNocturnoAction}>
                  <input type="hidden" name="dia" value={dia} />
                  <input type="hidden" name="activo" value={nocturno ? "0" : "1"} />
                  <Button type="submit" variant="outline" className="h-11">
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
          </div>
        </Desplegable>
      ) : null}

      {listo ? (
        <p className="text-center text-xs">
          <Link href={enlace(dia, asesoraPedida, !vistaClasica)} className="inline-flex min-h-11 items-center text-muted-foreground underline">
            {vistaClasica ? "Volver a «Acciones de hoy»" : "Ver el informe como antes (todo abierto)"}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
