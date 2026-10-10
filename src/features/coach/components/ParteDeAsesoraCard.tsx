import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import type { ParteDeAsesora } from "../servicios/leer-coach";
import type { ErrorDelCoach } from "../tipos";
import { HabilidadDelDia } from "./HabilidadDelDia";
import { PendientesDelCoach } from "./PendientesDelCoach";

const EJES: Array<{ clave: "V" | "N" | "A" | "S" | "C"; nombre: string }> = [
  { clave: "V", nombre: "Velocidad" },
  { clave: "N", nombre: "Necesidad" },
  { clave: "A", nombre: "Avance" },
  { clave: "S", nombre: "Seguimiento" },
  { clave: "C", nombre: "Comunicación" },
];

const TIPO_DE_ERROR: Record<string, string> = {
  sin_respuesta: "Sin respuesta",
  demora: "Demora",
  descarte_prematuro: "Descarte antes de tiempo",
  promesa_sin_cumplir: "Promesa sin cumplir",
  cobro_envio_gratis: "Cobró envío gratis",
  contraentrega: "Ofreció contraentrega",
  sin_cotizacion: "Sin cotización",
  sin_total_claro: "Sin total claro",
  dato_errado: "Dato errado",
  otro: "Otro",
};

function ChatLink({ item }: { item: Pick<ErrorDelCoach, "ref" | "numero" | "ultimos4" | "nombre"> }) {
  const texto = `${item.ref} · ${item.ultimos4}${item.nombre ? ` · ${item.nombre}` : ""}`;
  return item.numero ? (
    <Link href={`/c/${item.numero}`} className="font-medium text-foreground hover:underline">
      {texto}
    </Link>
  ) : (
    <span className="font-medium text-foreground">{texto}</span>
  );
}

function nota(valor: number | null | undefined) {
  return typeof valor === "number" ? valor.toFixed(1).replace(".", ",") : "—";
}

/** La parte de una asesora: puntaje por eje, lo que hizo bien, errores y sus pendientes. */
export function ParteDeAsesoraCard({ parte }: { parte: ParteDeAsesora }) {
  const m = parte.resumen?.metricas;
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>{parte.nombre}</span>
          <span className="text-sm font-normal text-muted-foreground">
            Puntaje <span className="text-lg font-semibold text-foreground tabular-nums">{nota(parte.puntaje)}</span>/10
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-5 gap-1 text-center">
          {EJES.map((eje) => (
            <div key={eje.clave} className="rounded-md bg-muted px-1 py-1.5">
              <div className="text-[10px] text-muted-foreground">{eje.nombre}</div>
              <div className="text-sm font-semibold tabular-nums">{nota(parte.puntajes?.ejes?.[eje.clave])}</div>
            </div>
          ))}
        </div>
        {m ? (
          <p className="text-xs text-muted-foreground">
            {m.chats} chats · {m.demoras} demoras · {m.sinRespuesta} sin respuesta · 1.ª respuesta (mediana){" "}
            {m.primeraRespuestaMedianaMin === null ? "—" : `${m.primeraRespuestaMedianaMin} min`} · {m.cotizaciones} con cotización ·{" "}
            {m.ganados} ganados
            {m.atribucionIncierta ? ` · ${m.atribucionIncierta} con atribución incierta` : ""}
          </p>
        ) : null}

        {parte.resumen?.loQueHizoBien ? (
          <p className="text-sm">
            <span className="font-medium">✅ Lo que hizo bien: </span>
            {parte.resumen.loQueHizoBien}
          </p>
        ) : null}

        {parte.resumen?.habilidad ? (
          <HabilidadDelDia habilidad={parte.resumen.habilidad} />
        ) : parte.resumen?.habilidad === null ? (
          <p className="text-sm text-muted-foreground">🎯 Sin habilidad prioritaria: no hubo errores medidos ese día.</p>
        ) : null}

        {parte.aciertos.length ? (
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Aciertos</h3>
            <ul className="space-y-1 text-sm">
              {parte.aciertos.map((acierto, i) => (
                <li key={`${acierto.ref}-${i}`}>
                  <ChatLink item={acierto} />: {acierto.texto}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="space-y-1">
          <h3 className="text-sm font-medium">Errores ({parte.errores.length})</h3>
          {parte.errores.length ? (
            <ul className="space-y-1.5 text-sm">
              {parte.errores.map((error, i) => (
                <li key={`${error.ref}-${error.tipo}-${i}`} className="flex flex-wrap items-baseline gap-1.5">
                  <Badge variant="outline" className="text-[10px]">
                    {TIPO_DE_ERROR[error.tipo] ?? error.tipo}
                  </Badge>
                  <ChatLink item={error} />
                  <span className="text-muted-foreground">{error.detalle}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Sin errores detectados.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <h3 className="text-sm font-medium">Pendientes para mañana ({parte.pendientes.length})</h3>
          <PendientesDelCoach pendientes={parte.pendientes} />
        </div>
      </CardContent>
    </Card>
  );
}
