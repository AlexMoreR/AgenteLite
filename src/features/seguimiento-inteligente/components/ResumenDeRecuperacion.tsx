import Link from "next/link";

import type { ResumenDeRecuperacion as Resumen } from "../servicios/recuperacion";
import { comoVista } from "../servicios/recuperacion";
import { AprobacionesDeRecuperacion, DeshacerDescarte } from "./RecuperacionDeMiDia";

/**
 * El bloque "Recuperación 72 h" del Supervisor: lo que está en curso (por fase y por asesora), lo
 * de las últimas 24 h (entraron, recuperados, descartados; en sombra, lo que HABRÍA pasado), los de
 * intención fuerte que esperan aprobación y los descartados de hoy con "Deshacer".
 */

const FASES: Array<{ clave: string; titulo: string }> = [
  { clave: "en_cola", titulo: "En cola (antes de hora)" },
  { clave: "llamar", titulo: "Por llamar" },
  { clave: "audio", titulo: "Por audio" },
  { clave: "espera", titulo: "En espera 24 h" },
  { clave: "llamar_2", titulo: "Segunda llamada" },
  { clave: "aprobacion", titulo: "Para aprobar" },
];

function hora(fecha: Date): string {
  return fecha.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" });
}

export function ResumenDeRecuperacion({ resumen }: { resumen: Resumen }) {
  const activo = resumen.modo === "activo";
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        A las 72 h sin respuesta, último intento humano (llamada → audio → 24 h) antes de “Descartado — Sin respuesta”. Modo{" "}
        <strong>{resumen.modo}</strong>
        {activo ? "." : ": solo anota lo que haría; a las asesoras no les aparece nada."}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { t: "Entraron (24 h)", v: resumen.hoy.entraron },
          { t: "Intención fuerte", v: resumen.hoy.fuertes },
          { t: "Recuperados", v: resumen.hoy.recuperados },
          { t: activo ? "Descartados" : "Habría descartado", v: activo ? resumen.hoy.descartados : resumen.hoy.habriaDescartado },
          { t: "Para aprobar", v: resumen.aprobaciones.length },
        ].map((c) => (
          <div key={c.t} className="rounded-md border border-border px-2 py-1.5">
            <p className="text-[11px] text-muted-foreground">{c.t}</p>
            <p className="text-lg font-semibold text-foreground">{c.v}</p>
          </div>
        ))}
      </div>
      {activo ? (
        <>
          <p className="text-xs text-muted-foreground">
            En curso: {FASES.map((f) => `${f.titulo} ${resumen.enCurso[f.clave] ?? 0}`).join(" · ")}
          </p>
          {resumen.porAsesora.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[22rem] text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 text-left font-medium">Asesora</th>
                    <th className="text-right font-medium">Llamar</th>
                    <th className="text-right font-medium">Audio</th>
                    <th className="text-right font-medium">Espera</th>
                    <th className="text-right font-medium">2.ª llamada</th>
                    <th className="text-right font-medium">Aprobar</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.porAsesora.map((f) => (
                    <tr key={f.asesora} className="border-t border-border/60">
                      <td className="py-1">{f.asesora}</td>
                      <td className="text-right">{f.llamar}</td>
                      <td className="text-right">{f.audio}</td>
                      <td className="text-right">{f.espera}</td>
                      <td className="text-right">{f.segunda}</td>
                      <td className="text-right">{f.aprobacion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Necesitan tu aprobación (intención fuerte)</p>
            <AprobacionesDeRecuperacion pendientes={resumen.aprobaciones.map(comoVista)} />
          </div>
        </>
      ) : null}
      {resumen.descartados.length ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Descartados en las últimas 24 h</p>
          <ul className="space-y-1">
            {resumen.descartados.map((d) => (
              <li key={d.conversationId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-xs">
                <span>
                  <span className="font-medium text-foreground">{d.nombre}</span>
                  {d.telefonoFinal ? <span className="text-muted-foreground"> · •••• {d.telefonoFinal}</span> : null}
                  <span className="text-muted-foreground"> · {hora(d.en)} · {d.asesora ?? "sin asesora"}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Link href={`/cliente/chats?chatKey=${encodeURIComponent(`agent:${d.conversationId}`)}&assigned=all`} className="font-medium text-primary hover:underline">
                    Abrir chat
                  </Link>
                  <DeshacerDescarte conversationId={d.conversationId} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
