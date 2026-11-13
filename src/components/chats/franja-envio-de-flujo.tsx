"use client";

import * as React from "react";
import { LoaderCircle, TriangleAlert, Workflow, X } from "lucide-react";

import { textoDeLaFranja, type AvanceDeFlujo } from "@/lib/flujos/avance-de-flujo";

/**
 * Franja «Enviando «flujo»: N de M» arriba de la caja de escribir (parte 3 de «Flujos: que se envíen
 * completos aunque la asesora cambie de chat, y al instante»).
 *
 * El flujo lo manda el servidor (EnvioDeFlujo). Esta franja solo LEE el avance en
 * /api/cliente/chats/avance-de-flujo: no manda nada. La ven TODAS las pantallas con ese chat abierto,
 * no solo la de quien tocó «Enviar flujo»: pregunta al abrir el chat, cuando llega un mensaje nuevo
 * (`senal`) y cuando esta pantalla manda un flujo (evento AVISO_ENVIO_DE_FLUJO). Mientras haya uno
 * en curso pregunta cada CADA_MS y se detiene cuando ya no queda ninguno.
 *
 * Si terminó con fallas dice cuántos no salieron, hasta que la asesora la cierre (o pasen unos
 * minutos: lo decide la ruta).
 */

/** El diálogo de flujos lo dispara en `window` al recibir el envioId: «hay un envío en curso en este chat». */
export const AVISO_ENVIO_DE_FLUJO = "aizen:envio-de-flujo";
export type DetalleAvisoEnvioDeFlujo = { conversationId: string; envioId: string; total: number };

const CADA_MS = 1500;

export function avisarEnvioDeFlujoEnCurso(detalle: DetalleAvisoEnvioDeFlujo) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DetalleAvisoEnvioDeFlujo>(AVISO_ENVIO_DE_FLUJO, { detail: detalle }));
}

async function leerAvance(conversationId: string, senal: AbortSignal): Promise<AvanceDeFlujo[] | null> {
  try {
    const respuesta = await fetch(`/api/cliente/chats/avance-de-flujo?conversationId=${encodeURIComponent(conversationId)}`, {
      cache: "no-store",
      signal: senal,
    });
    if (!respuesta.ok) return null;
    const cuerpo = (await respuesta.json()) as { ok?: boolean; envios?: AvanceDeFlujo[] };
    return cuerpo.ok && Array.isArray(cuerpo.envios) ? cuerpo.envios : null;
  } catch {
    // Sin señal o el chat cambió: la próxima vuelta (o el próximo mensaje) vuelve a preguntar.
    return null;
  }
}

export function FranjaEnvioDeFlujo({
  conversationId,
  senal,
  onAvance,
}: {
  /** Id pelado del chat abierto (el mismo que recibe «Enviar flujo»). */
  conversationId: string | null | undefined;
  /** Cambia cuando llega un mensaje nuevo al chat: se vuelve a preguntar (así lo ve otra asesora). */
  senal?: string | number;
  /** Salió un paso más: el panel trae los mensajes de ese chat. */
  onAvance?: (envio: { conversationId: string }) => void;
}) {
  const [envios, setEnvios] = React.useState<AvanceDeFlujo[]>([]);
  const [cerrados, setCerrados] = React.useState<ReadonlySet<string>>(() => new Set());
  // Se sube cada vez que hay que preguntar de una (aviso del diálogo o mensaje nuevo).
  const [pedido, setPedido] = React.useState(0);
  const onAvanceRef = React.useRef(onAvance);
  React.useEffect(() => {
    onAvanceRef.current = onAvance;
  }, [onAvance]);
  // Lo último visto de cada envío, para avisar al panel solo cuando sube el número.
  const vistosRef = React.useRef(new Map<string, number>());

  // Otro chat: se olvida lo de antes.
  React.useEffect(() => {
    setEnvios([]);
    setCerrados(new Set());
    vistosRef.current = new Map();
  }, [conversationId]);

  React.useEffect(() => {
    setPedido((n) => n + 1);
  }, [senal]);

  React.useEffect(() => {
    if (!conversationId) return;
    const alAviso = (evento: Event) => {
      const detalle = (evento as CustomEvent<DetalleAvisoEnvioDeFlujo>).detail;
      if (detalle?.conversationId === conversationId) setPedido((n) => n + 1);
    };
    window.addEventListener(AVISO_ENVIO_DE_FLUJO, alAviso);
    return () => window.removeEventListener(AVISO_ENVIO_DE_FLUJO, alAviso);
  }, [conversationId]);

  React.useEffect(() => {
    if (!conversationId) return;
    const control = new AbortController();
    let temporizador: number | null = null;
    let vigente = true;

    const vuelta = async () => {
      const leidos = await leerAvance(conversationId, control.signal);
      if (!vigente) return;
      if (leidos) {
        let avanzo = false;
        for (const envio of leidos) {
          const antes = vistosRef.current.get(envio.envioId);
          if (antes !== undefined && envio.enviados > antes) avanzo = true;
          vistosRef.current.set(envio.envioId, envio.enviados);
        }
        // Uno que estaba y ya no viene terminó bien: salió el último paso.
        for (const envioId of [...vistosRef.current.keys()]) {
          if (!leidos.some((envio) => envio.envioId === envioId)) {
            vistosRef.current.delete(envioId);
            avanzo = true;
          }
        }
        setEnvios(leidos);
        if (avanzo) {
          try {
            onAvanceRef.current?.({ conversationId });
          } catch {
            // El refresco es de respaldo: la bandeja igual trae los mensajes sola.
          }
        }
      }
      // Sigue mientras haya uno en curso; si la lectura falló, reintenta igual (la red se pudo cortar).
      const sigue = leidos ? leidos.some((envio) => envio.estado === "EN_CURSO") : true;
      if (sigue) temporizador = window.setTimeout(() => void vuelta(), CADA_MS);
    };
    void vuelta();

    return () => {
      vigente = false;
      control.abort();
      if (temporizador !== null) window.clearTimeout(temporizador);
    };
  }, [conversationId, pedido]);

  const visibles = envios.filter((envio) => !cerrados.has(envio.envioId));
  if (!conversationId || visibles.length === 0) return null;

  return (
    <div className="mb-1.5 flex flex-col gap-1.5">
      {visibles.map((envio) =>
        envio.estado === "EN_CURSO" ? (
          <div
            key={envio.envioId}
            className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/70 px-3 py-1.5 text-[13px] text-muted-foreground"
            role="status"
          >
            <Workflow className="size-4 shrink-0 text-[var(--primary)]" />
            <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
            <span className="min-w-0 flex-1 truncate">{textoDeLaFranja(envio)}</span>
          </div>
        ) : (
          <div
            key={envio.envioId}
            className="flex min-w-0 items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 dark:border-amber-900 dark:bg-amber-950/40"
            role="status"
          >
            <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="min-w-0 flex-1 text-[12px] leading-4 text-amber-900 dark:text-amber-200">
              {textoDeLaFranja(envio)}. Mándalos a mano o vuelve a enviar el flujo.
            </span>
            <button
              type="button"
              onClick={() => setCerrados((antes) => new Set(antes).add(envio.envioId))}
              aria-label="Cerrar aviso"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-amber-800 transition hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ),
      )}
    </div>
  );
}
