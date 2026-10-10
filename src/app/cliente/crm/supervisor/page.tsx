import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ETIQUETA_DE_SEVERIDAD, type Severidad } from "@/features/supervisor/dominio/tipos";
import { escenariosDelCombo } from "@/features/supervisor/dominio/escenarios";
import { correrGuardian } from "@/features/supervisor/dominio/guardian";
import { diffDelLibro } from "@/features/supervisor/dominio/libro-diff";
import { leerAlertasRecientes } from "@/features/supervisor/servicios/almacen-alertas";
import { supervisorActivo } from "@/features/supervisor/servicios/config";
import { leerFlujosDelLibro, leerLineaDelLibro } from "@/features/supervisor/servicios/datos";
import { idsDelComboEnElLibro } from "@/features/supervisor/servicios/vueltas";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const COLOR: Record<Severidad, string> = {
  CRITICO: "border-red-500/60 bg-red-500/5",
  IMPORTANTE: "border-amber-500/60 bg-amber-500/5",
  OBSERVACION: "border-border",
};

function hora(fecha: Date): string {
  return fecha.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" });
}

/**
 * SUPERVISOR (fase 1): las alertas abiertas y recientes, y el Change Guardian del libro V3 actual.
 * Solo lectura: esta pantalla no cambia nada del bot, del reparto ni de los chats.
 */
export default async function SupervisorPage() {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!(await puedeSupervisar(access))) {
    redirect("/cliente/crm/mi-dia");
  }
  const workspaceId = access.workspaceId;

  const [activo, alertas, linea] = await Promise.all([
    supervisorActivo(workspaceId),
    leerAlertasRecientes(workspaceId).catch(() => null),
    leerLineaDelLibro(workspaceId),
  ]);

  const ids = idsDelComboEnElLibro(linea.actual);
  const anterior = linea.libros.get(linea.actual.version - 1) ?? null;
  const flujos = await leerFlujosDelLibro(workspaceId, linea.actual).catch(() => ({}));
  const informe = ids.productoComboId
    ? correrGuardian({
        candidato: linea.actual,
        anterior,
        escenarios: escenariosDelCombo({ productoComboId: ids.productoComboId, flujoFotosCombo: ids.flujoFotosCombo }),
        flujos,
      })
    : null;
  const diff = anterior ? diffDelLibro(anterior, linea.actual) : null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Supervisor</h1>
        <p className="text-sm text-muted-foreground">
          Vigila el bot, el embudo y la atención contra su línea base y avisa. No cambia nada: cada alerta trae su
          recomendación y, si toca producción, espera la autorización del dueño.{" "}
          <Link href="/cliente/crm/embudo" className="underline">
            Ver el embudo
          </Link>
        </p>
        {!activo ? (
          <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
            Apagado. Se prende con el ajuste <code>supervisor:activo:{workspaceId}</code> = <code>true</code>.
          </p>
        ) : null}
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Change Guardian del libro V3 (versión {linea.actual.version})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {informe ? (
            <>
              <p className="font-medium">{informe.resumen}</p>
              {diff ? <p className="text-muted-foreground">Cambio desde la versión {diff.versionAnterior}: {diff.resumen}</p> : null}
              <ul className="space-y-1">
                {informe.resultados.map((r) => (
                  <li key={r.id} className={r.pasa ? "text-muted-foreground" : "text-foreground"}>
                    {r.pasa ? "✓" : "✗"} {r.nombre}
                    {r.critico ? " (crítico)" : ""}
                    {r.dependeDeLaIa ? " · depende de la IA" : ""} — ganó «{r.regla ?? "ninguna"}»
                    {r.fallas.length ? `: ${r.fallas.join("; ")}` : ""}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-muted-foreground">El libro no tiene un producto de combo reconocible: no hay escenarios que correr.</p>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Alertas (abiertas y de los últimos 14 días)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {alertas === null ? (
            <p className="text-sm text-muted-foreground">Todavía no existe la tabla de alertas (falta la migración).</p>
          ) : alertas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin alertas.</p>
          ) : (
            alertas.map((alerta) => (
              <details key={alerta.id} className={`rounded-md border px-3 py-2 ${COLOR[alerta.severidad]}`}>
                <summary className="cursor-pointer text-sm">
                  <span className="font-semibold">[{ETIQUETA_DE_SEVERIDAD[alerta.severidad]}]</span> {alerta.titulo}
                  <span className="text-muted-foreground">
                    {" "}
                    · desde {hora(alerta.desde)} · {alerta.estado === "ABIERTA" ? "abierta" : `resuelta ${alerta.resueltaEn ? hora(alerta.resueltaEn) : ""}`}
                  </span>
                </summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-foreground">{alerta.texto}</pre>
              </details>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
