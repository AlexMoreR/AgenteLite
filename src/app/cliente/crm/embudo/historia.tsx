"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import { estadoDelRellenoAction, lanzarRellenoAction } from "@/app/actions/embudo-relleno-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { EstadoDelRelleno } from "@/features/embudo/servicios/relleno";

type Linea = { id: string; nombre: string; agenteV3: boolean; activa: boolean };

const ETIQUETA_TIPO: Record<string, string> = {
  ENTRADA: "Entradas",
  BIENVENIDA_ENVIADA: "Bienvenidas",
  CLIENTE_RESPONDIO: "Respondió",
  PASO_ENTRA: "Cambios de paso",
  RECOMENDACION_ENVIADA: "Recomendaciones",
  SENAL: "Señales",
  TURNO_V3: "Turnos del bot",
  SEGUIMIENTO_ENVIADO: "Seguimientos",
  ETAPA_CRM: "Cambios de etapa",
  ESCALADO: "Pidió asesora",
  ASIGNADA: "Asignaciones",
  ASESORA_RESPONDIO: "Asesora respondió",
  VENTA: "Ventas",
};

const hora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" }) : "—";

/**
 * HISTORIA DEL EMBUDO (solo el dueño): reconstruye los eventos de semanas pasadas a partir de los
 * chats guardados. "Simular" solo cuenta; "Guardar historia" escribe. Corre en el servidor en
 * segundo plano; esta tarjeta muestra el avance y se refresca sola cada 4 s mientras corre.
 */
export function HistoriaDelEmbudo(props: {
  lineas: Linea[];
  lineaPorDefecto: string | null;
  desdePorDefecto: string;
  hoy: string;
  estadoInicial: EstadoDelRelleno | null;
}) {
  const [lineaId, setLineaId] = useState(props.lineaPorDefecto ?? props.lineas[0]?.id ?? "");
  const [desde, setDesde] = useState(props.desdePorDefecto);
  const [hasta, setHasta] = useState(props.hoy);
  const [estado, setEstado] = useState<EstadoDelRelleno | null>(props.estadoInicial);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const corriendo = estado?.estado === "corriendo";

  const refrescar = useCallback(() => {
    iniciar(async () => {
      const respuesta = await estadoDelRellenoAction();
      if (respuesta.ok) setEstado(respuesta.estado ?? null);
      else setAviso(respuesta.error ?? "No se pudo leer el estado.");
    });
  }, []);

  useEffect(() => {
    if (!corriendo) return;
    const reloj = setInterval(async () => {
      const respuesta = await estadoDelRellenoAction().catch(() => null);
      if (respuesta?.ok) setEstado(respuesta.estado ?? null);
    }, 4000);
    return () => clearInterval(reloj);
  }, [corriendo]);

  const lanzar = (modo: "simular" | "guardar") => {
    if (
      modo === "guardar" &&
      !window.confirm(
        `Se van a guardar los eventos de ${desde} a ${hasta} en el embudo. No duplica lo que ya está y no cambia nada del bot ni del reparto. ¿Seguir?`,
      )
    ) {
      return;
    }
    setAviso(null);
    iniciar(async () => {
      const respuesta = await lanzarRellenoAction({ modo, lineaId, desde, hasta });
      if (respuesta.estado !== undefined) setEstado(respuesta.estado ?? null);
      if (!respuesta.ok) setAviso(respuesta.error ?? "No se pudo lanzar.");
    });
  };

  const porTipo = Object.entries(estado?.porTipo ?? {}).sort((a, b) => b[1] - a[1]);
  const porcentaje = estado?.total ? Math.round((estado.procesados / estado.total) * 100) : null;

  return (
    <Card size="sm">
      <CardHeader className="pb-1">
        <CardTitle className="text-base">Historia</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Reconstruye el embudo de días pasados a partir de los chats guardados (mensajes, notas del agente, asignaciones y
          ventas). Primero simula para ver cuánto sale; después guarda. Se puede repetir: no duplica nada. Solo lo ve el dueño.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>Línea</span>
            <NativeSelect value={lineaId} onChange={(e) => setLineaId(e.target.value)} className="h-8" disabled={corriendo}>
              {props.lineas.map((linea) => (
                <NativeSelectOption key={linea.id} value={linea.id}>
                  {linea.nombre}
                  {linea.agenteV3 ? " (Agente V3)" : ""}
                  {linea.activa ? "" : " (inactiva)"}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>Desde</span>
            <Input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className="h-8 w-40" disabled={corriendo} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>Hasta</span>
            <Input type="date" value={hasta} max={props.hoy} onChange={(e) => setHasta(e.target.value)} className="h-8 w-40" disabled={corriendo} />
          </label>
          <Button type="button" size="sm" variant="outline" disabled={pendiente || corriendo || !lineaId} onClick={() => lanzar("simular")}>
            Simular
          </Button>
          <Button type="button" size="sm" disabled={pendiente || corriendo || !lineaId} onClick={() => lanzar("guardar")}>
            Guardar historia
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={pendiente} onClick={refrescar}>
            Actualizar
          </Button>
        </div>

        {aviso ? <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">{aviso}</p> : null}

        {estado ? (
          <div className="space-y-2 rounded-lg border border-border px-3 py-2 text-sm">
            <p>
              <span className="font-medium">
                {estado.estado === "corriendo" ? "Corriendo" : estado.estado === "listo" ? "Terminado" : "Con error"}
              </span>{" "}
              · {estado.modo === "guardar" ? "guardar historia" : "simulación (no escribe)"} · {estado.lineaNombre ?? estado.lineaId} ·{" "}
              {estado.desde} a {estado.hasta}
            </p>
            <p className="text-xs text-muted-foreground">
              Chats: {estado.procesados}
              {estado.total !== null ? ` de ${estado.total}` : ""}
              {porcentaje !== null ? ` (${porcentaje} %)` : ""} · inicio {hora(estado.inicio)} · {estado.fin ? `fin ${hora(estado.fin)}` : `último avance ${hora(estado.actualizado)}`}
              {estado.modo === "guardar" ? ` · eventos nuevos guardados: ${estado.insertados} · leads recalculados: ${estado.leadsRecalculados}` : ""}
            </p>
            {estado.error ? <p className="text-sm text-destructive">{estado.error}</p> : null}
            {porTipo.length ? (
              <ul className="grid gap-x-4 text-xs sm:grid-cols-2">
                {porTipo.map(([tipo, cuantos]) => (
                  <li key={tipo} className="flex justify-between gap-2 border-b border-border py-0.5">
                    <span>{ETIQUETA_TIPO[tipo] ?? tipo}</span>
                    <span className="tabular-nums text-muted-foreground">{cuantos.toLocaleString("es-CO")}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {estado.modo === "guardar" && estado.estado === "listo" ? (
              <p className="text-xs text-muted-foreground">Recarga la página para ver el embudo con la historia.</p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Todavía no se ha corrido el relleno en este negocio.</p>
        )}
      </CardContent>
    </Card>
  );
}
