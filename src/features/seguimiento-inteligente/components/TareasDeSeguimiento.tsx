import Link from "next/link";

import { enlaceAlChat } from "@/features/supervisor/dominio/chats-de-la-alerta";

import { nombreDeFamilia } from "../dominio/producto";
import type { TareaDeSeguimiento } from "../servicios/tareas";

/**
 * La lista de tareas del seguimiento inteligente (Mi día y Supervisor). Solo muestra: el mensaje
 * sugerido lo copia y lo manda la asesora; el sistema no le escribe al cliente.
 */

const MOTIVOS: Record<string, string> = {
  caliente_esperando: "Caliente esperando respuesta",
  tibio_esperando: "Preguntó algo concreto y espera",
  esperando_con_bot_pausado: "Espera respuesta (bot en pausa)",
  caliente_sin_asesora: "Caliente: nadie le ha escrito",
  tibio_sin_asesora: "Pregunta concreta: escríbele tú",
  cotizacion_sin_respuesta: "Cotización sin respuesta",
  fecha_futura_cerca: "Se acerca la fecha que dijo",
  cadencia_sin_respuesta: "Seguimiento después de tu mensaje",
  cadencia_tope_de_automaticos: "Seguimiento después de tu mensaje",
};

const COLOR: Record<string, string> = {
  A: "bg-red-500/15 text-red-700 dark:text-red-300",
  B: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  C: "bg-muted text-muted-foreground",
};

function hora(fecha: Date | null): string {
  return fecha ? fecha.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" }) : "";
}

export function TareasDeSeguimiento({ tareas, ahora = new Date(), mostrarAsesora = false }: { tareas: TareaDeSeguimiento[]; ahora?: Date; mostrarAsesora?: boolean }) {
  if (!tareas.length) return <p className="text-sm text-muted-foreground">Sin tareas de seguimiento por ahora.</p>;
  return (
    <ul className="space-y-2">
      {tareas.map((tarea) => {
        const vencida = tarea.vence ? tarea.vence.getTime() <= ahora.getTime() : true;
        return (
          <li key={tarea.conversationId} className="rounded-md border border-border bg-background/60 px-3 py-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm">
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${COLOR[tarea.prioridad] ?? COLOR.C}`}>{tarea.prioridad}</span>
                  <span className="font-medium text-foreground">{tarea.nombre}</span>
                  {tarea.telefonoFinal ? <span className="text-muted-foreground"> · •••• {tarea.telefonoFinal}</span> : null}
                  {tarea.modo !== "activo" ? <span className="ml-2 text-[11px] text-muted-foreground">(sombra)</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {MOTIVOS[tarea.motivo] ?? tarea.motivo.replace(/_/g, " ")}
                  {tarea.toque ? ` · ${tarea.toque.replace("dia_", "día ").replace("cotizacion_", "cotización ")}` : ""}
                  {tarea.producto ? ` · ${nombreDeFamilia(tarea.producto)}` : ""}
                  {tarea.temperatura ? ` · ${tarea.temperatura.toLowerCase()}` : ""}
                  {tarea.vence ? ` · ${vencida ? "venció" : "vence"} ${hora(tarea.vence)}` : ""}
                  {mostrarAsesora ? ` · ${tarea.asesoraNombre ?? "sin asesora"}` : ""}
                </p>
                {tarea.topeEstado === "redistribuida" ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Pasada por tope de {tarea.deNombre ?? "otra asesora"}
                    {mostrarAsesora && tarea.paraNombre ? ` a ${tarea.paraNombre}` : ""} (el chat sigue siendo de {tarea.deNombre ?? "ella"})
                  </p>
                ) : tarea.topeEstado === "pospuesta" ? (
                  <p className="text-xs text-muted-foreground">
                    Pospuesta por tope{tarea.pospuestaHasta ? ` hasta ${hora(tarea.pospuestaHasta)}` : ""}: nadie tenía cupo hoy
                  </p>
                ) : null}
              </div>
              <Link
                href={enlaceAlChat(tarea.conversationId)}
                className="shrink-0 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-muted"
              >
                Abrir chat
              </Link>
            </div>
            {tarea.mensajeSugerido ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs font-medium text-primary">Mensaje sugerido</summary>
                <p className="mt-1 whitespace-pre-wrap rounded bg-muted/50 px-2 py-1.5 text-xs text-foreground">{tarea.mensajeSugerido}</p>
              </details>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
