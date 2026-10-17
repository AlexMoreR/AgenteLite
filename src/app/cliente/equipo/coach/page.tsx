import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { moverDia } from "@/features/coach/dominio/acciones-de-hoy";
import {
  armarSerie,
  asesorasDe,
  metricaDe,
  resolverRango,
  resumenParaTarjetas,
  textoDelRango,
} from "@/features/coach/dominio/linea-de-tiempo";
import { FiltroDeMetrica, FiltroDeRango } from "@/features/coach/components/linea/FiltrosDelCoach";
import { GraficoDelCoach } from "@/features/coach/components/linea/GraficoDelCoach";
import { TarjetaDeAsesora } from "@/features/coach/components/linea/TarjetaDeAsesora";
import { indiceDeClave } from "@/features/coach/components/linea/colores";
import { diaEnBogota } from "@/features/coach/reglas";
import { leerDiasDelCoach } from "@/features/coach/servicios/linea-coach";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** Para las tarjetas: los ultimos 14 dias alcanzan para tener ayer y el informe anterior. */
const DIAS_PARA_TARJETAS = 14;

/**
 * COACH (primera pagina). Arriba, "Cómo va mejorando cada una": una linea por asesora, dia a dia,
 * con la metrica que se elija. Abajo, una tarjeta corta por asesora con "Ver detalle" a su seccion
 * (/cliente/equipo/coach/asesora/<userId>). El informe completo de un dia sigue en ./informe.
 *
 * Todo sale de los informes guardados (servicios/linea-coach.ts -> dominio/linea-de-tiempo.ts).
 * Quien supervisa ve a todo el equipo; una asesora ve solo su linea y su tarjeta.
 */
export default async function CoachPage({ searchParams }: PageProps) {
  const params = await searchParams;
  // Enlaces viejos (?dia=…, ?vista=clasica, ?generando=1): eran el informe de un dia.
  if (params.dia || params.vista || params.generando) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (typeof v === "string") q.set(k, v);
    redirect(`/cliente/equipo/coach/informe?${q.toString()}`);
  }
  if (typeof params.asesora === "string" && params.asesora) {
    redirect(`/cliente/equipo/coach/asesora/${encodeURIComponent(params.asesora)}`);
  }

  const access = await requireClientWorkspaceAccess("crm");
  const supervisa = await puedeSupervisar(access);
  const soloUserId = supervisa ? undefined : access.userId;

  const hoy = diaEnBogota(new Date());
  const ayer = moverDia(hoy, -1);
  const rango = resolverRango({ rango: params.rango, desde: params.desde, hasta: params.hasta }, hoy, "7d");
  const metrica = metricaDe(params.metrica);

  const desdeTarjetas = moverDia(ayer, -(DIAS_PARA_TARJETAS - 1));
  const alcanza = rango.desde <= desdeTarjetas && rango.hasta >= ayer;
  const [dias, diasDeTarjetas] = await Promise.all([
    leerDiasDelCoach(access.workspaceId, rango.desde, rango.hasta, { soloUserId }),
    alcanza ? Promise.resolve(null) : leerDiasDelCoach(access.workspaceId, desdeTarjetas, ayer, { soloUserId }),
  ]);
  const paraTarjetas = diasDeTarjetas ?? dias;

  // Mismo orden y color para la linea y la tarjeta: todas las asesoras que salen en una u otra.
  const asesoras = asesorasDe([...dias, ...paraTarjetas]);
  const enLaSerie = asesoras.filter((a) => dias.some((d) => d.userId === a.userId));
  const filas = armarSerie(dias, rango, metrica.clave, enLaSerie);
  const tarjetas = resumenParaTarjetas(paraTarjetas, ayer, metrica);
  const indiceDe = (userId: string) => indiceDeClave(asesoras.find((a) => a.userId === userId)?.clave ?? "a0");

  const actuales: Record<string, string> = {};
  for (const k of ["rango", "desde", "hasta", "metrica"]) {
    const v = texto(params[k]);
    if (v) actuales[k] = v;
  }
  const destino = { base: "/cliente/equipo/coach", actuales };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5">
      <h1 className="text-lg font-semibold">Coach</h1>

      <FiltroDeRango {...destino} rango={rango} opciones={["7d", "semana", "mes"]} hoy={hoy} />

      <Card>
        <CardHeader>
          <CardTitle>{supervisa ? "Cómo va mejorando cada una" : "Cómo vas mejorando"}</CardTitle>
          <CardDescription>
            {metrica.nombre} · {textoDelRango(rango)}. {metrica.ayuda}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <FiltroDeMetrica {...destino} metrica={metrica.clave} />
          <GraficoDelCoach filas={filas} asesoras={enLaSerie} metrica={metrica} />
          <p className="text-xs text-muted-foreground">Un día sin informe queda en blanco (no cuenta como cero).</p>
        </CardContent>
      </Card>

      <section aria-labelledby="titulo-asesoras" className="space-y-3">
        <h2 id="titulo-asesoras" className="text-base font-semibold">
          {supervisa ? "Hoy, cada asesora" : "Tu día de hoy"}
        </h2>
        {tarjetas.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tarjetas.map((t) => (
              <TarjetaDeAsesora
                key={t.userId}
                resumen={t}
                indice={indiceDe(t.userId)}
                metrica={metrica}
                ayer={ayer}
                href={`/cliente/equipo/coach/asesora/${encodeURIComponent(t.userId)}`}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">
            No hay informes del Coach de los últimos {DIAS_PARA_TARJETAS} días.
          </p>
        )}
      </section>

      <p className="text-center text-sm">
        <Link
          href={`/cliente/equipo/coach/informe?dia=${ayer}`}
          className="inline-flex min-h-11 items-center text-muted-foreground underline"
        >
          {access.isOwner || access.role === "ADMIN" ? "Informe completo de un día y generar el informe" : "Ver el informe completo de un día"}
        </Link>
      </p>
    </div>
  );
}
