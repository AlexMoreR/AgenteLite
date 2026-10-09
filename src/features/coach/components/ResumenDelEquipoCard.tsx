import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import type { InformeDelCoach } from "../servicios/leer-coach";

const MOTIVO: Record<string, string> = {
  mala_ejecucion: "Mala ejecución",
  sin_intencion: "Sin intención",
  sin_dinero: "Sin dinero",
  precio: "Precio",
  envio: "Envío",
  producto: "Producto",
  sistema: "Sistema / bot",
  bien_trabajada_no_cerro: "Bien trabajada, no cerró",
  en_curso: "En curso",
  vendida: "Vendida",
};

/** Solo para quien supervisa: cifras del dia, motivos y la separacion asesoras / sistema. */
export function ResumenDelEquipoCard({ informe }: { informe: InformeDelCoach }) {
  const r = informe.resumenEquipo;
  if (!r) return null;
  const cifras: Array<[string, number]> = [
    ["Leads nuevos", r.leads],
    ["Chats con movimiento", r.chatsConActividad],
    ["Calientes", r.calientes],
    ["Tibios", r.tibios],
    ["Cotizaciones", r.cotizaciones],
    ["Ventas", r.ventas],
    ["Sin asesora", r.sinAsesora],
  ];
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-base">Resumen del equipo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">{r.resumen}</p>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          {cifras.map(([nombre, valor]) => (
            <div key={nombre} className="rounded-md bg-muted px-2 py-1.5">
              <div className="text-[10px] text-muted-foreground">{nombre}</div>
              <div className="text-base font-semibold tabular-nums">{valor}</div>
            </div>
          ))}
        </div>

        {r.motivos.length ? (
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Por qué no se cerró</h3>
            <ul className="text-sm">
              {r.motivos.map((m) => (
                <li key={m.motivo} className="flex justify-between gap-2 border-b border-border py-1 last:border-0">
                  <span>{MOTIVO[m.motivo] ?? m.motivo}</span>
                  <span className="tabular-nums text-muted-foreground">{m.casos}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Errores de las asesoras</h3>
            {r.erroresDeAsesoras.length ? (
              <ul className="space-y-1 text-sm">
                {r.erroresDeAsesoras.map((a) => (
                  <li key={a.userId}>
                    <span className="font-medium">{a.nombre}</span>: {a.total}
                    {a.total ? (
                      <span className="text-muted-foreground">
                        {" "}
                        ({Object.entries(a.porTipo)
                          .map(([tipo, n]) => `${tipo.replace(/_/g, " ")} ${n}`)
                          .join(", ")}
                        )
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Ninguno.</p>
            )}
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Fallas del sistema o del bot</h3>
            {r.fallasDelSistema.length ? (
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {r.fallasDelSistema.map((f, i) => (
                  <li key={i}>
                    {f.ref ? <span className="font-medium">{f.ref} </span> : null}
                    {f.texto}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Ninguna detectada.</p>
            )}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Política: {informe.versionPolitica} · {informe.chatsLeidos} chats leídos · {informe.llamadasIA} llamadas a la IA
          {informe.modelo ? ` (${informe.modelo})` : ""} · {informe.tokensEntrada.toLocaleString("es-CO")} +{" "}
          {informe.tokensSalida.toLocaleString("es-CO")} tokens · US$ {informe.costoUsd.toFixed(4)}
          {r.iaDisponible ? "" : " · sin IA (solo métricas medidas)"}
        </p>
      </CardContent>
    </Card>
  );
}
