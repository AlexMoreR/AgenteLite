import Link from "next/link";

import { enlaceAlChat } from "@/features/supervisor/dominio/chats-de-la-alerta";

import type { PausaAcordadaDelChat } from "../servicios/datos";

/**
 * La lista "En pausa acordada" del Supervisor (26-10-2026): clientes que dejaron la compra en pausa
 * y ya fueron atendidos. No son alertas; el día de retomar le sale una tarea a la asesora. Solo muestra.
 */

function dia(fecha: Date): string {
  return fecha.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
}

export function PausasAcordadas({ pausas }: { pausas: PausaAcordadaDelChat[] }) {
  if (!pausas.length) return <p className="text-sm text-muted-foreground">Ningún cliente en pausa acordada por ahora.</p>;
  return (
    <ul className="space-y-2">
      {pausas.map((pausa) => (
        <li key={pausa.conversationId} className="rounded-md border border-border bg-background/60 px-3 py-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm">
                <span className="font-medium text-foreground">{pausa.nombre}</span>
                {pausa.telefonoFinal ? <span className="text-muted-foreground"> · •••• {pausa.telefonoFinal}</span> : null}
                <span className="text-muted-foreground"> · {pausa.asesoraNombre ?? "sin asesora"}</span>
              </p>
              {pausa.frase ? <p className="text-xs text-foreground">Dijo: «{pausa.frase}»</p> : null}
              <p className="text-xs text-muted-foreground">
                Retomar el {dia(pausa.retomarEn)}
                {pausa.como ? ` (${pausa.como})` : ""}
              </p>
            </div>
            <Link
              href={enlaceAlChat(pausa.conversationId)}
              className="shrink-0 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-muted"
            >
              Abrir chat
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
