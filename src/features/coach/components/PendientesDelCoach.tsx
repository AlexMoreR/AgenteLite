import Link from "next/link";

import { Badge } from "@/components/ui/badge";

import type { PendienteDelCoach } from "../tipos";

const TEMPERATURA: Record<PendienteDelCoach["temperatura"], { etiqueta: string; icono: string }> = {
  caliente: { etiqueta: "Caliente", icono: "🔥" },
  tibio: { etiqueta: "Tibio", icono: "🟡" },
  frio: { etiqueta: "Frío", icono: "❄️" },
  cerrado: { etiqueta: "Cerrado", icono: "✅" },
  no_perseguir: { etiqueta: "No perseguir", icono: "💤" },
};

/**
 * La lista de pendientes que dejo el coach: a quien escribir mañana y que decirle. Solo lectura:
 * el mensaje es una sugerencia, lo manda (o no) la asesora desde el chat.
 */
export function PendientesDelCoach({ pendientes, max }: { pendientes: PendienteDelCoach[]; max?: number }) {
  const lista = typeof max === "number" ? pendientes.slice(0, max) : pendientes;
  if (!lista.length) {
    return <p className="text-sm text-muted-foreground">Sin pendientes: no quedaron clientes calientes ni tibios.</p>;
  }
  return (
    <ul className="space-y-2">
      {lista.map((pendiente) => {
        const temperatura = TEMPERATURA[pendiente.temperatura] ?? TEMPERATURA.frio;
        const titulo = `${pendiente.ref} · ${pendiente.ultimos4}${pendiente.nombre ? ` · ${pendiente.nombre}` : ""}`;
        return (
          <li key={pendiente.ref} className="space-y-1 rounded-lg border border-border px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span aria-hidden>{temperatura.icono}</span>
              {pendiente.numero ? (
                <Link href={`/c/${pendiente.numero}`} className="text-sm font-medium text-foreground hover:underline">
                  {titulo}
                </Link>
              ) : (
                <span className="text-sm font-medium text-foreground">{titulo}</span>
              )}
              <Badge variant="secondary" className="text-[10px]">
                {temperatura.etiqueta}
              </Badge>
              {pendiente.urgente ? (
                <Badge variant="destructive" className="text-[10px]">
                  Sin respuesta
                </Badge>
              ) : null}
            </div>
            {pendiente.porque ? <p className="text-xs text-muted-foreground">{pendiente.porque}</p> : null}
            {pendiente.siguienteMensaje ? (
              <p className="rounded-md bg-muted px-2 py-1.5 text-sm text-foreground">
                <span className="text-xs text-muted-foreground">Sugerido: </span>
                {pendiente.siguienteMensaje}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
