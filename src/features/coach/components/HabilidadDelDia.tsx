import Link from "next/link";

import { NOMBRE_DE_ETAPA } from "../habilidad";
import type { HabilidadDelDia as Habilidad } from "../tipos";

/**
 * La habilidad del dia de UNA asesora (habilidad-v1): que entrenar, con la evidencia de sus chats,
 * que hacer diferente, un mensaje modelo y la meta de mañana. La eligio el codigo con sus conteos
 * (politica.ts, `habilidad`), no la IA.
 */
export function HabilidadDelDia({ habilidad, compacta = false }: { habilidad: Habilidad; compacta?: boolean }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">
      <p className="font-medium">
        🎯 Habilidad del día: <span className="text-foreground">{habilidad.nombre}</span>
      </p>
      <p className="text-xs text-muted-foreground">
        Meta de mañana: <span className="font-medium text-foreground">{habilidad.metrica.texto}</span>
        {habilidad.etapaCritica ? ` · Donde más se pierde: ${NOMBRE_DE_ETAPA[habilidad.etapaCritica]}` : ""}
      </p>
      {habilidad.evidencia.length ? (
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-muted-foreground">Evidencia</p>
          <ul className="space-y-0.5">
            {habilidad.evidencia.map((e, i) => (
              <li key={`${e.ref}-${i}`}>
                {e.numero ? (
                  <Link href={`/c/${e.numero}`} className="font-medium text-foreground hover:underline">
                    {e.ref} · {e.ultimos4}
                  </Link>
                ) : (
                  <span className="font-medium">
                    {e.ref} · {e.ultimos4}
                  </span>
                )}
                : <span className="text-muted-foreground">{e.texto}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p>
        <span className="font-medium">Qué hacer diferente: </span>
        {habilidad.queHacerDiferente}
      </p>
      <div className="space-y-0.5">
        <p className="text-xs font-medium text-muted-foreground">Mensaje modelo</p>
        <p className="whitespace-pre-line rounded-md border border-border bg-background px-2.5 py-1.5">{habilidad.ejemplo}</p>
      </div>
      {compacta ? null : (
        <p className="text-[11px] text-muted-foreground">
          Elegida por el sistema con tus conteos del día (impacto {habilidad.impacto.toString().replace(".", ",")})
          {habilidad.incluyeErrorDelEquipo ? " · incluye un error que también tuvo el equipo" : ""} · redacción:{" "}
          {habilidad.redactadoPor === "ia" ? "IA" : "plantilla"}.
        </p>
      )}
    </div>
  );
}
