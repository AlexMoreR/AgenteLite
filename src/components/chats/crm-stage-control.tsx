"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, ChevronDown } from "lucide-react";
import { updateCrmStageAction } from "@/app/actions/crm-actions";
import { CRM_LOST_REASONS, CRM_STAGE_META, CRM_STAGE_ORDER } from "@/features/crm/domain/crm-config";
import type { CrmStage } from "@/features/crm/types";

/**
 * Cuanta gente hay en cada etapa, compartido por todas las filas.
 *
 * El selector se abre desde cientos de conversaciones: si cada una pidiera el conteo, abrir la
 * lista serian cientos de consultas para un numero que cambia de a poco. Se pide una vez y se
 * reusa durante medio minuto.
 */
const VIDA_DEL_CONTEO_MS = 30_000;
let conteoEnMemoria: { datos: Record<string, number>; pedidoEn: number } | null = null;
let conteoEnVuelo: Promise<Record<string, number>> | null = null;

async function traerConteoDeEtapas(): Promise<Record<string, number>> {
  if (conteoEnMemoria && Date.now() - conteoEnMemoria.pedidoEn < VIDA_DEL_CONTEO_MS) {
    return conteoEnMemoria.datos;
  }
  if (conteoEnVuelo) {
    return conteoEnVuelo;
  }

  conteoEnVuelo = fetch("/api/cliente/crm/conteo-etapas", {
    credentials: "same-origin",
    cache: "no-store",
  })
    .then((respuesta) => (respuesta.ok ? respuesta.json() : null))
    .then((datos: { conteo?: Record<string, number> } | null) => {
      const conteo = datos?.conteo ?? {};
      conteoEnMemoria = { datos: conteo, pedidoEn: Date.now() };
      return conteo;
    })
    .catch(() => ({}))
    .finally(() => {
      conteoEnVuelo = null;
    });

  return conteoEnVuelo;
}

type CrmStageControlProps = {
  contactId: string;
  stage: CrmStage;
  /**
   * Como se abre el selector.
   *
   * "pill" es el boton de color con el nombre de la etapa (cabecera del chat). "chip" es la
   * chapita chica que va en la fila de etiquetas de la lista de chats: ahi tiene que verse como
   * una etiqueta mas, no como un boton, pero se toca y abre el mismo selector.
   */
  variant?: "pill" | "chip";
};


// Color de relleno del botón por etapa.
const STAGE_BUTTON_CLASS: Record<CrmStage, string> = {
  NUEVO: "bg-violet-500 hover:bg-violet-600",
  CALIFICADO: "bg-cyan-500 hover:bg-cyan-600",
  PROPUESTA: "bg-yellow-500 hover:bg-yellow-600",
  NEGOCIACION: "bg-orange-500 hover:bg-orange-600",
  GANADO: "bg-emerald-500 hover:bg-emerald-600",
  PERDIDO: "bg-red-600 hover:bg-red-700",
};

export function CrmStageControl({ contactId, stage, variant = "pill" }: CrmStageControlProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [currentStage, setCurrentStage] = useState<CrmStage>(stage);
  const [error, setError] = useState<string | null>(null);
  // Segundo paso del modal: eligio "Descartado" y falta el motivo.
  const [askingLostReason, setAskingLostReason] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setCurrentStage(stage);
  }, [stage]);

  const commitStage = useCallback(
    (nextStage: CrmStage, lostReason?: string) => {
      setError(null);
      const previousStage = currentStage;
      setCurrentStage(nextStage);
      setOpen(false);
      setAskingLostReason(false);
      startTransition(async () => {
        const result = await updateCrmStageAction({ contactId, status: nextStage, lostReason });
        if (result?.error) {
          setCurrentStage(previousStage);
          setError(result.error);
          return;
        }
        router.refresh();
      });
    },
    [contactId, currentStage, router],
  );

  const handleSelect = useCallback(
    (nextStage: CrmStage) => {
      if (nextStage === currentStage) {
        setOpen(false);
        return;
      }

      // Descartar pide el motivo en un segundo paso, dentro del mismo modal. Es el unico dato
      // del CRM que no se puede deducir de la conversacion —por que se cayo la venta lo sabe
      // solo quien vende— y sin el, el informe de razones de perdida no existe. Se pregunta
      // aca, en el momento en que ella ya tiene la respuesta en la cabeza, y no despues.
      if (nextStage === "PERDIDO") {
        setError(null);
        setAskingLostReason(true);
        return;
      }

      commitStage(nextStage);
    },
    [commitStage, currentStage],
  );

  const currentLabel = CRM_STAGE_META[currentStage].label;

  /*
    Cerrar tocando afuera o con Escape.

    Un modal se cierra solo con su boton; un panel anclado tiene que cerrarse como cualquier menu,
    porque uno lo abre de paso y sigue trabajando.
  */
  const menuRef = useRef<HTMLDivElement | null>(null);
  const botonRef = useRef<HTMLButtonElement | null>(null);
  /*
    El panel se dibuja FUERA de la lista, contra la pantalla.

    Dentro de la fila quedaba cortado: la lista de chats tiene su propio recorte y su scroll, y
    cualquier cosa que se salga de la fila se corta contra ese borde. Se veia apenas una franja
    blanca asomando. Por eso se mide donde quedo la etiqueta y se dibuja encima de todo.
  */
  const [posicion, setPosicion] = useState<{ top: number; left: number } | null>(null);
  const [conteo, setConteo] = useState<Record<string, number>>(() => conteoEnMemoria?.datos ?? {});

  useEffect(() => {
    if (!open) {
      setPosicion(null);
      return;
    }

    const ubicar = () => {
      const caja = botonRef.current?.getBoundingClientRect();
      if (!caja) {
        return;
      }
      const ancho = 224;
      const margen = 12;
      // Se pega al boton, pero sin salirse de la pantalla por ninguno de los dos lados.
      const izquierda = Math.min(
        Math.max(margen, caja.left),
        Math.max(margen, window.innerWidth - ancho - margen),
      );
      setPosicion({ top: caja.bottom + 6, left: izquierda });
    };

    ubicar();
    // El conteo se pide al ABRIR, no al pintar la fila: si no, serian cientos de consultas por
    // un dato que casi nadie mira.
    void traerConteoDeEtapas().then(setConteo);
    // Si la lista se desplaza con el panel abierto, seguirlo seria peor que cerrarlo: quedaria
    // flotando lejos de la fila que lo abrio.
    const cerrar = () => setOpen(false);
    window.addEventListener("resize", cerrar);
    window.addEventListener("scroll", cerrar, true);
    return () => {
      window.removeEventListener("resize", cerrar);
      window.removeEventListener("scroll", cerrar, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const alTocarAfuera = (evento: MouseEvent) => {
      const destino = evento.target as Node;
      // El panel vive fuera de este contenedor, asi que se revisan los dos por separado.
      if (
        !menuRef.current?.contains(destino) &&
        !botonRef.current?.contains(destino)
      ) {
        setOpen(false);
        setAskingLostReason(false);
      }
    };
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") {
        setOpen(false);
        setAskingLostReason(false);
      }
    };
    document.addEventListener("mousedown", alTocarAfuera);
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.removeEventListener("mousedown", alTocarAfuera);
      document.removeEventListener("keydown", alTeclear);
    };
  }, [open]);

  return (
    /*
      Panel anclado a la etiqueta, NO un modal.

      Cambiar de etapa es un gesto chico y frecuente: un modal a pantalla completa tapa la
      conversacion, oscurece todo y hay que cerrarlo aparte. Se abre pegado a la etiqueta que
      tocaste, como el panel de filtros, y se cierra tocando afuera.
    */
    <div className="relative inline-flex max-w-full">
      <button
        ref={botonRef}
        type="button"
        disabled={isPending}
        onClick={() => setOpen((abierto) => !abierto)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={error ?? `Etapa CRM: ${currentLabel}`}
        className={
          variant === "chip"
            ? `inline-flex max-w-full shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-[2px] text-[11px] font-semibold leading-[1.3] transition disabled:opacity-60 ${CRM_STAGE_META[currentStage].borderClassName} ${CRM_STAGE_META[currentStage].backgroundClassName} ${CRM_STAGE_META[currentStage].accentClassName}`
            : `inline-flex h-7 max-w-[160px] items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-white transition disabled:opacity-60 ${STAGE_BUTTON_CLASS[currentStage]}`
        }
      >
        <span className="truncate">{currentLabel}</span>
        {variant === "chip" ? null : <ChevronDown className="h-3 w-3 shrink-0 opacity-80" />}
      </button>

      {open && posicion && typeof document !== "undefined"
        ? createPortal(
        <div
          ref={menuRef}
          style={{ top: posicion.top, left: posicion.left, width: 224 }}
          className="fixed z-[100] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-border bg-popover shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)]"
        >
          {/*
            Sin titulo: la lista de etapas de colores ya dice que es esto, y el renglon gastaba
            espacio en una pantalla de celular. La cabecera queda solo para poder VOLVER cuando se
            esta eligiendo el motivo de la perdida.
          */}
          {askingLostReason ? (
            <button
              type="button"
              onClick={() => setAskingLostReason(false)}
              className="flex w-full items-center gap-1.5 border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              ¿Por qué se perdió?
            </button>
          ) : null}

          <div className="max-h-[60vh] overflow-y-auto py-1">
            {askingLostReason
              ? CRM_LOST_REASONS.map((reason) => (
                  <button
                    key={reason.value}
                    type="button"
                    disabled={isPending}
                    onClick={() => commitStage("PERDIDO", reason.value)}
                    className="flex w-full items-center px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
                  >
                    {reason.label}
                  </button>
                ))
              : CRM_STAGE_ORDER.map((stageValue) => (
                  <button
                    key={stageValue}
                    type="button"
                    disabled={isPending}
                    onClick={() => handleSelect(stageValue)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition hover:bg-muted disabled:opacity-50"
                  >
                    {/* La MISMA pastilla que se ve en la lista y en el chat. */}
                    <span
                      className={`inline-flex max-w-full shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[12px] font-semibold leading-[1.3] ${CRM_STAGE_META[stageValue].borderClassName} ${CRM_STAGE_META[stageValue].backgroundClassName} ${CRM_STAGE_META[stageValue].accentClassName}`}
                    >
                      {CRM_STAGE_META[stageValue].label}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {/*
                        Cuanta gente hay ahi. Ver que "Tibio" tiene 0 y "Frio" mil dice mas del
                        embudo que cualquier informe, y lo dice justo cuando uno va a mover a
                        alguien.
                      */}
                      {conteo[stageValue] === undefined ? null : (
                        <span className="text-[12px] font-medium tabular-nums text-muted-foreground">
                          {conteo[stageValue]}
                        </span>
                      )}
                      {stageValue === currentStage ? (
                        <Check className="h-4 w-4 text-emerald-500" />
                      ) : null}
                    </span>
                  </button>
                ))}
          </div>
        </div>,
        document.body,
          )
        : null}
    </div>
  );
}
