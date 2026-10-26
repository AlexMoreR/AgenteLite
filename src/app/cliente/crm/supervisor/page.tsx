import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MAX_CHATS_POR_ALERTA,
  enlaceAlChat,
  filasDeLaAlerta,
  idsDeChatsDeLaAlerta,
  textoSinIds,
  type FilaDeChatDeAlerta,
} from "@/features/supervisor/dominio/chats-de-la-alerta";
import { ETIQUETA_DE_SEVERIDAD, type Severidad } from "@/features/supervisor/dominio/tipos";
import { escenariosDelCombo } from "@/features/supervisor/dominio/escenarios";
import { correrGuardian } from "@/features/supervisor/dominio/guardian";
import { diffDelLibro } from "@/features/supervisor/dominio/libro-diff";
import { leerAlertasRecientes } from "@/features/supervisor/servicios/almacen-alertas";
import { leerDatosDeChats } from "@/features/supervisor/servicios/chats-de-alertas";
import { supervisorActivo } from "@/features/supervisor/servicios/config";
import { enHorario } from "@/features/supervisor/dominio/detectores-atencion";
import { leerChatsAbiertos, leerFlujosDelLibro, leerLineaDelLibro } from "@/features/supervisor/servicios/datos";
import { leerConfigTurno } from "@/lib/turno-config";
import { idsDelComboEnElLibro } from "@/features/supervisor/servicios/vueltas";
import { TareasDeSeguimiento } from "@/features/seguimiento-inteligente/components/TareasDeSeguimiento";
import { leerConfigSeguimiento } from "@/features/seguimiento-inteligente/servicios/config";
import { leerTareasParaSupervisor, resumenDelMotor } from "@/features/seguimiento-inteligente/servicios/tareas";
import { ResumenDeRecuperacion } from "@/features/seguimiento-inteligente/components/ResumenDeRecuperacion";
import { resumenDeRecuperacion } from "@/features/seguimiento-inteligente/servicios/recuperacion";
import { bloqueDelCierreDelDia, fechaBogota } from "@/features/avisos-gravedad/dominio/reglas";
import { leerConfigGravedad, leerResumenDelDia } from "@/features/avisos-gravedad/servicios/enrutador";
import { PanelAccionableView } from "@/features/supervisor-accionable/components/PanelAccionable";
import { anclaDeAlerta } from "@/features/supervisor-accionable/dominio/reglas";
import { leerConfigAccionable, leerPanelAccionable } from "@/features/supervisor-accionable/servicios/accionable";
import { PanelReasignacion } from "@/features/supervisor-reasignacion/components/PanelReasignacion";
import { leerDatosDeLaTarjeta } from "@/features/supervisor-reasignacion/servicios/config";
import { leerRegistroDelDia } from "@/features/supervisor-reasignacion/servicios/registro";
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
 * Un chat afectado: quién es, qué dijo, cuánto espera y el botón para abrirlo. El id va de tooltip.
 * En las alertas de ATENCIÓN es una tarea (tarjeta); en los incidentes del bot o del embudo es solo
 * un EJEMPLO del incidente (línea simple, sin estilo de pendiente).
 */
function ChatAfectado({ fila, ejemplo = false }: { fila: FilaDeChatDeAlerta; ejemplo?: boolean }) {
  return (
    <li
      className={
        ejemplo
          ? "flex flex-wrap items-start justify-between gap-2 px-1 py-1"
          : "flex flex-wrap items-start justify-between gap-2 rounded-md border border-border bg-background/60 px-3 py-2"
      }
    >
      <div className="min-w-0 flex-1 space-y-0.5" title={`ID interno: ${fila.conversationId}`}>
        <p className="text-sm">
          <span className={fila.encontrado ? "font-medium text-foreground" : "font-medium text-muted-foreground"}>{fila.nombre}</span>
          {fila.telefono ? <span className="text-muted-foreground"> · {fila.telefono}</span> : null}
          {fila.esperando ? <span className="text-muted-foreground"> · esperando {fila.esperando}</span> : null}
        </p>
        {fila.frase ? <p className="text-xs text-foreground/80">«{fila.frase}»</p> : null}
        <p className="text-xs text-muted-foreground">
          {fila.encontrado ? (fila.asesora ? `Asesora: ${fila.asesora}` : "Sin asesora asignada") : null}
          <span className="ml-1 text-[10px] opacity-60">ID {fila.conversationId}</span>
        </p>
      </div>
      {fila.href ? (
        <Link
          href={fila.href}
          className="shrink-0 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-muted"
        >
          Abrir chat
        </Link>
      ) : null}
    </li>
  );
}

/**
 * SUPERVISOR (fase 1): las alertas abiertas y recientes, y el Change Guardian del libro V3 actual.
 * Solo lectura: esta pantalla no cambia nada del bot, del reparto ni de los chats.
 */
export default async function SupervisorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // ?alerta=<clave> (botón "Ver el incidente" de Prioridades de Alexander): esa alerta llega abierta y a la vista.
  const pedida = (await searchParams).alerta;
  const alertaPedida = typeof pedida === "string" ? pedida : null;
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

  // Supervisor accionable: Prioridades de Alexander + lo que está en manos de las asesoras.
  const configAccionable = await leerConfigAccionable(workspaceId).catch(() => null);
  // Fuera de horario: los chats abiertos para "N clientes esperando fuera de horario" (de día no hace falta).
  const ahora = new Date();
  const chatsFueraDeHorario =
    configAccionable?.activo && !enHorario(ahora)
      ? await leerChatsAbiertos({ workspaceId, ahora, conTurno: (await leerConfigTurno(workspaceId).catch(() => null))?.activo }).catch(() => [])
      : [];
  const panelAccionable = configAccionable?.activo
    ? await leerPanelAccionable(workspaceId, (alertas ?? []).filter((alerta) => alerta.estado === "ABIERTA"), ahora, chatsFueraDeHorario).catch(() => null)
    : null;

  // Avisos por WhatsApp y reasignación automática: la tarjeta de ajustes y el registro de hoy (solo el dueño).
  const esDueno = access.isOwner || access.role === "ADMIN";
  const [tarjetaReasignacion, registroReasignacion] = esDueno
    ? await Promise.all([leerDatosDeLaTarjeta(workspaceId).catch(() => null), leerRegistroDelDia(workspaceId).catch(() => null)])
    : [null, null];

  const configAvisos = await leerConfigGravedad(workspaceId).catch(() => null);
  const avisos = {
    resumen: configAvisos?.activo ? await leerResumenDelDia(workspaceId, fechaBogota(new Date())) : null,
  };

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

  // Los chats de todas las alertas se resuelven en UNA consulta, solo dentro de este negocio.
  const idsDeChats = (alertas ?? []).flatMap((alerta) => idsDeChatsDeLaAlerta(alerta.hallazgos, Number.POSITIVE_INFINITY));
  const datosPorChat = await leerDatosDeChats(workspaceId, idsDeChats).catch(() => null);
  const chatsDe = (hallazgos: NonNullable<typeof alertas>[number]["hallazgos"]): FilaDeChatDeAlerta[] => {
    const filas = filasDeLaAlerta({ hallazgos, datosPorChat: datosPorChat ?? new Map(), ahora, max: Number.POSITIVE_INFINITY });
    // Si la consulta falló no se sabe si el chat existe: se deja el enlace en vez de decir "no encontrado".
    return datosPorChat
      ? filas
      : filas.map((fila) => ({ ...fila, nombre: "Datos del chat no disponibles", href: enlaceAlChat(fila.conversationId) }));
  };

  /*
    Las alertas de ATENCIÓN son tareas (chats pendientes, con estilo de pendiente). Las del bot, del
    embudo y de los cambios del libro son incidentes o métricas: sus chats son EJEMPLOS del
    incidente, no pendientes de nadie (Alexander, 10-10-2026).
  */
  type Alerta = NonNullable<typeof alertas>[number];
  const operativas = (alertas ?? []).filter((alerta) => alerta.familia === "ATENCION");
  const incidentes = (alertas ?? []).filter((alerta) => alerta.familia !== "ATENCION");
  const anclasUsadas = new Set<string>();
  const tarjeta = (alerta: Alerta, esIncidente: boolean) => {
    const chats = chatsDe(alerta.hallazgos);
    const visibles = chats.slice(0, MAX_CHATS_POR_ALERTA);
    // El ancla va en la primera fila de cada clave (la abierta va primero): nunca dos ids iguales.
    const ancla = anclaDeAlerta(alerta.clave);
    const conAncla = !anclasUsadas.has(ancla);
    anclasUsadas.add(ancla);
    return (
      <details
        key={alerta.id}
        id={conAncla ? ancla : undefined}
        open={conAncla && alertaPedida === alerta.clave ? true : undefined}
        className={`scroll-mt-20 rounded-md border px-3 py-2 ${COLOR[alerta.severidad]}`}
      >
        <summary className="cursor-pointer text-sm">
          <span className="font-semibold">[{ETIQUETA_DE_SEVERIDAD[alerta.severidad]}]</span> {alerta.titulo}
          <span className="text-muted-foreground">
            {" "}
            · desde {hora(alerta.desde)} · {alerta.estado === "ABIERTA" ? "abierta" : `resuelta ${alerta.resueltaEn ? hora(alerta.resueltaEn) : ""}`}
            {chats.length ? ` · ${chats.length} ${esIncidente ? "ejemplo(s)" : "chat(s)"}` : ""}
          </span>
        </summary>
        {visibles.length ? (
          <div className="mt-2 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {esIncidente ? "Ejemplos del incidente" : "Chats pendientes"}
              {chats.length > visibles.length ? ` (primeros ${visibles.length} de ${chats.length})` : ""}
            </p>
            <ul className={esIncidente ? "divide-y divide-border/60" : "space-y-1.5"}>
              {visibles.map((fila) => (
                <ChatAfectado key={fila.conversationId} fila={fila} ejemplo={esIncidente} />
              ))}
            </ul>
          </div>
        ) : null}
        <pre className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-foreground">{datosPorChat ? textoSinIds(alerta.texto, chats) : alerta.texto}</pre>
      </details>
    );
  };

  // Seguimiento inteligente: solo si está prendido (en sombra o activo).
  const configSeguimiento = await leerConfigSeguimiento(workspaceId);
  const seguimiento =
    configSeguimiento.motor.modo !== "apagado"
      ? {
          modo: configSeguimiento.motor.modo,
          dias: configSeguimiento.cadencia.dias,
          tareas: await leerTareasParaSupervisor(workspaceId, ahora).catch(() => []),
          resumen: await resumenDelMotor(workspaceId, ahora).catch(() => []),
        }
      : null;
  // Recuperación 72 h: solo si está prendida (sombra o activo).
  const recuperacion =
    configSeguimiento.recuperacion72h.modo !== "apagado"
      ? await resumenDeRecuperacion(workspaceId, configSeguimiento.recuperacion72h.modo, ahora).catch(() => null)
      : null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5">
      {/* Sin título ni párrafo (pedido de Alex, 11-oct-2026): lo primero son sus prioridades. */}
      {!activo ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          Apagado. Se prende con el ajuste <code>supervisor:activo:{workspaceId}</code> = <code>true</code>.
        </p>
      ) : null}

      {panelAccionable ? <PanelAccionableView panel={panelAccionable} /> : null}

      {tarjetaReasignacion ? <PanelReasignacion datos={tarjetaReasignacion} registro={registroReasignacion} /> : null}

      {avisos.resumen ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Avisos por gravedad · hoy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Críticos: push + WhatsApp a Alexander. Importantes: push. Operativos: solo a la asesora. Observaciones: solo
              este resumen.
            </p>
            <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{bloqueDelCierreDelDia(avisos.resumen)}</pre>
          </CardContent>
        </Card>
      ) : null}

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

      {recuperacion ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Recuperación 72 h</CardTitle>
          </CardHeader>
          <CardContent>
            <ResumenDeRecuperacion resumen={recuperacion} />
          </CardContent>
        </Card>
      ) : null}

      {seguimiento ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Seguimiento inteligente · tareas de hoy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Lo que el motor deja para una persona (Tibio, Caliente, cotización, fecha cercana y la cadencia de los días{" "}
              {seguimiento.dias.join(", ")}). Motor en modo <strong>{seguimiento.modo}</strong>
              {seguimiento.modo === "sombra" ? ": solo muestra lo que haría, no le aparece a las asesoras." : "."}
              {seguimiento.resumen.length
                ? ` Últimas 24 h: ${seguimiento.resumen.map((r) => `${r.accion.replace(/_/g, " ")} ${r.total}`).join(" · ")}.`
                : ""}
            </p>
            <TareasDeSeguimiento tareas={seguimiento.tareas} ahora={ahora} mostrarAsesora />
          </CardContent>
        </Card>
      ) : null}

      {alertas === null ? (
        <Card size="sm">
          <CardContent>
            <p className="text-sm text-muted-foreground">Todavía no existe la tabla de alertas (falta la migración).</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card size="sm">
            <CardHeader>
              <CardTitle>Atención: tareas del equipo (abiertas y de los últimos 14 días)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {operativas.length === 0 ? <p className="text-sm text-muted-foreground">Sin alertas de atención.</p> : operativas.map((alerta) => tarjeta(alerta, false))}
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>Incidentes del bot y del embudo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {incidentes.length === 0 ? <p className="text-sm text-muted-foreground">Sin incidentes.</p> : incidentes.map((alerta) => tarjeta(alerta, true))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
