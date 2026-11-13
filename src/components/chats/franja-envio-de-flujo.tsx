"use client";

import * as React from "react";
import { LoaderCircle, RotateCw, TriangleAlert, Workflow, X } from "lucide-react";

import { reintentarPasoDeFlujoPorRuta } from "@/lib/chats/enviar-por-ruta";
import { textoDeLaFranja, type AvanceDeFlujo, type PasoDelAvance } from "@/lib/flujos/avance-de-flujo";

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
 * minutos: lo decide la ruta). Cada paso que no salió trae «No salió · Reintentar» (parte 4): manda
 * SOLO ese paso por /api/cliente/chats/reintentar-paso-de-flujo y la franja se vuelve a leer.
 */

/** El diálogo de flujos lo dispara en `window` al recibir el envioId: «hay un envío en curso en este chat». */
export const AVISO_ENVIO_DE_FLUJO = "aizen:envio-de-flujo";
export type DetalleAvisoEnvioDeFlujo = { conversationId: string; envioId: string; total: number };

const CADA_MS = 1500;
/** Si la lectura falla por la red, se reintenta con espera creciente hasta este tope de veces seguidas. */
const REINTENTOS_DE_RED = 5;
const ESPERA_MAXIMA_MS = 10_000;

const NOMBRE_DEL_TIPO: Record<PasoDelAvance["tipo"], string> = {
  text: "Texto",
  image: "Foto",
  video: "Video",
  document: "Documento",
  audio: "Audio",
};

const SIN_RESPUESTA_AL_REINTENTAR = "No hubo respuesta. Revisa el chat antes de volver a intentar: pudo haber salido.";

export function avisarEnvioDeFlujoEnCurso(detalle: DetalleAvisoEnvioDeFlujo) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DetalleAvisoEnvioDeFlujo>(AVISO_ENVIO_DE_FLUJO, { detail: detalle }));
}

/**
 * «ok» con los envíos; «permanente» si la ruta dijo que no (sesión vencida, sin permiso, chat
 * inválido): no se vuelve a preguntar; «red» si no hubo respuesta o el servidor falló: se reintenta.
 */
type Lectura = { tipo: "ok"; envios: AvanceDeFlujo[] } | { tipo: "permanente" } | { tipo: "red" };

async function leerAvance(conversationId: string, senal: AbortSignal): Promise<Lectura> {
  try {
    const respuesta = await fetch(`/api/cliente/chats/avance-de-flujo?conversationId=${encodeURIComponent(conversationId)}`, {
      cache: "no-store",
      signal: senal,
    });
    if (respuesta.status >= 400 && respuesta.status < 500) return { tipo: "permanente" };
    if (!respuesta.ok) return { tipo: "red" };
    const cuerpo = (await respuesta.json()) as { ok?: boolean; envios?: AvanceDeFlujo[] };
    return cuerpo.ok && Array.isArray(cuerpo.envios) ? { tipo: "ok", envios: cuerpo.envios } : { tipo: "permanente" };
  } catch {
    // Sin señal o el chat cambió: se reintenta (si había uno en curso) o pregunta el próximo mensaje.
    return { tipo: "red" };
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
  // Había uno en curso y ya no se pudo leer el avance: se dice, en vez de dejar el número congelado.
  const [sinAvance, setSinAvance] = React.useState(false);
  // Lo último leído, para saber (fuera del render) si había uno en curso cuando falla la lectura.
  const enviosRef = React.useRef<AvanceDeFlujo[]>([]);
  // Se sube cada vez que hay que preguntar de una (aviso del diálogo o mensaje nuevo).
  const [pedido, setPedido] = React.useState(0);
  const onAvanceRef = React.useRef(onAvance);
  React.useEffect(() => {
    onAvanceRef.current = onAvance;
  }, [onAvance]);
  // Lo último visto de cada envío, para avisar al panel solo cuando sube el número.
  const vistosRef = React.useRef(new Map<string, number>());
  // «envioId:indice» del paso que se está reintentando, y el error del último reintento de cada paso.
  const [reintentando, setReintentando] = React.useState<string | null>(null);
  const [erroresDeReintento, setErroresDeReintento] = React.useState<ReadonlyMap<string, string>>(() => new Map());

  const reintentar = React.useCallback(async (envioId: string, indice: number) => {
    const clave = `${envioId}:${indice}`;
    setReintentando(clave);
    setErroresDeReintento((antes) => {
      const nuevos = new Map(antes);
      nuevos.delete(clave);
      return nuevos;
    });
    let error: string | null = null;
    try {
      const resultado = await reintentarPasoDeFlujoPorRuta({ envioId, indice });
      if (!resultado.ok) error = resultado.error;
    } catch {
      error = SIN_RESPUESTA_AL_REINTENTAR;
    }
    if (error) {
      const texto = error;
      setErroresDeReintento((antes) => new Map(antes).set(clave, texto));
    }
    setReintentando(null);
    // Se vuelve a leer: el paso queda «enviado» (o fallido otra vez) y el número sube.
    setPedido((n) => n + 1);
  }, []);

  // Otro chat: se olvida lo de antes.
  React.useEffect(() => {
    setEnvios([]);
    setCerrados(new Set());
    setSinAvance(false);
    setReintentando(null);
    setErroresDeReintento(new Map());
    enviosRef.current = [];
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
    let fallosSeguidos = 0;

    const vuelta = async () => {
      const lectura = await leerAvance(conversationId, control.signal);
      if (!vigente) return;
      if (lectura.tipo !== "ok") {
        // Solo se insiste si había uno en curso a la vista; un error de la ruta (4xx) no se reintenta.
        const habiaEnCurso = enviosRef.current.some((envio) => envio.estado === "EN_CURSO");
        fallosSeguidos += 1;
        if (lectura.tipo === "red" && habiaEnCurso && fallosSeguidos <= REINTENTOS_DE_RED) {
          const espera = Math.min(CADA_MS * 2 ** fallosSeguidos, ESPERA_MAXIMA_MS);
          temporizador = window.setTimeout(() => void vuelta(), espera);
        } else if (habiaEnCurso) {
          setSinAvance(true);
        }
        return;
      }
      fallosSeguidos = 0;
      setSinAvance(false);
      const leidos = lectura.envios;
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
      enviosRef.current = leidos;
      setEnvios(leidos);
      if (avanzo) {
        try {
          onAvanceRef.current?.({ conversationId });
        } catch {
          // El refresco es de respaldo: la bandeja igual trae los mensajes sola.
        }
      }
      // Sigue mientras haya uno en curso.
      if (leidos.some((envio) => envio.estado === "EN_CURSO")) temporizador = window.setTimeout(() => void vuelta(), CADA_MS);
    };
    void vuelta();

    return () => {
      vigente = false;
      control.abort();
      if (temporizador !== null) window.clearTimeout(temporizador);
    };
  }, [conversationId, pedido]);

  // Sin poder leer, el «N de M» en curso quedaría congelado: se cambia por un aviso.
  const visibles = envios.filter((envio) => !cerrados.has(envio.envioId) && !(sinAvance && envio.estado === "EN_CURSO"));
  if (!conversationId || (visibles.length === 0 && !sinAvance)) return null;

  return (
    <div className="mb-1.5 flex flex-col gap-1.5">
      {sinAvance ? (
        <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/70 px-3 py-1.5 text-[13px] text-muted-foreground" role="status">
          <Workflow className="size-4 shrink-0 text-[var(--primary)]" />
          <span className="min-w-0 flex-1 truncate">No se puede ver el avance del flujo. Revisa los mensajes del chat.</span>
        </div>
      ) : null}
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
            className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 dark:border-amber-900 dark:bg-amber-950/40"
            role="status"
          >
            <div className="flex min-w-0 items-center gap-2">
              <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="min-w-0 flex-1 text-[12px] leading-4 text-amber-900 dark:text-amber-200">
                {textoDeLaFranja(envio)}. Reintenta los que no salieron.
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
            <ul className="flex flex-col gap-1 pl-6">
              {envio.pasos
                .filter((paso) => paso.estado === "fallido")
                .map((paso) => {
                  const clave = `${envio.envioId}:${paso.indice}`;
                  const enCurso = reintentando === clave;
                  const errorDelReintento = erroresDeReintento.get(clave);
                  return (
                    <li key={clave} className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-amber-900 dark:text-amber-200">
                          Paso {paso.indice + 1} · {NOMBRE_DEL_TIPO[paso.tipo] ?? "Paso"} · No salió
                        </span>
                        <button
                          type="button"
                          onClick={() => void reintentar(envio.envioId, paso.indice)}
                          disabled={reintentando !== null}
                          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 text-[12px] font-medium text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-800 dark:bg-transparent dark:text-amber-200 dark:hover:bg-amber-900/40"
                        >
                          {enCurso ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
                          {enCurso ? "Enviando…" : "Reintentar"}
                        </button>
                      </div>
                      {errorDelReintento ? (
                        <span className="text-[11px] leading-4 text-amber-800 dark:text-amber-300" role="alert">
                          {errorDelReintento}
                        </span>
                      ) : paso.error ? (
                        <span className="truncate text-[11px] leading-4 text-amber-800/80 dark:text-amber-300/80">{paso.error}</span>
                      ) : null}
                    </li>
                  );
                })}
            </ul>
          </div>
        ),
      )}
    </div>
  );
}
