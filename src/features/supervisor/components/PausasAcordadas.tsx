import Link from "next/link";

import type { PausaAcordadaDelLead } from "@/features/seguimiento-inteligente/servicios/tareas";

import { enlaceAlChat } from "../dominio/chats-de-la-alerta";

/**
 * "En pausa acordada": los clientes que dejaron la compra en espera y a quienes ya se les respondió. No son
 * alerta; se retoman en su fecha con un mensaje de valor. Solo muestra: el sistema no les escribe.
 */

function fecha(valor: Date): string {
  return valor.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
}

export function PausasAcordadas({ pausas }: { pausas: PausaAcordadaDelLead[] }) {
  if (!pausas.length) return <p className="text-sm text-muted-foreground">Ningún cliente en pausa acordada por ahora.</p>;
  return (
    <ul className="space-y-2">
      {pausas.map((pausa) => (
        <li key={pausa.conversationId} className="rounded-md border border-border bg-background/60 px-3 py-2">
          <p className="text-sm">
            <Link href={enlaceAlChat(pausa.conversationId)} className="font-medium text-foreground underline-offset-2 hover:underline">
              {pausa.nombre}
            </Link>
            {pausa.telefonoFinal ? <span className="text-muted-foreground"> · •••• {pausa.telefonoFinal}</span> : null}
            <span className="text-muted-foreground"> · {pausa.asesoraNombre ?? "sin asesora"}</span>
            {pausa.modo !== "activo" ? <span className="ml-2 text-[11px] text-muted-foreground">(sombra)</span> : null}
          </p>
          {pausa.frase ? <p className="text-xs text-foreground">Dijo: «{pausa.frase}»</p> : null}
          <p className="text-xs text-muted-foreground">
            Retomar el {fecha(pausa.retomarEn)}
            {pausa.como ? ` · ${pausa.como}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
