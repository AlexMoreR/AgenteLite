"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ClipboardCopy, LoaderCircle, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  buscarDatosEnElChatAction,
  guardarFichaDeCotizacionAction,
  leerFichaDeCotizacionAction,
  type Origenes,
} from "@/app/actions/quote-data-actions";
import {
  CAMPOS_DE_FICHA,
  fichaVacia,
  type CampoDeFicha,
  type FichaDeCotizacion,
  type Sugerencias,
} from "../services/datos-de-cotizacion";

/**
 * Los datos que hacen falta para cotizarle a este cliente.
 *
 * Se pueden escribir a mano, como siempre, o pedirle a la app que los busque en la conversacion:
 * cuando el cliente decide comprar ya dicto su cedula y su direccion, y hoy alguien las vuelve a
 * tipear releyendo el chat hacia arriba.
 *
 * Lo que encuentra se PROPONE, con la frase textual del cliente al lado; nadie guarda nada hasta
 * que una persona lo acepta. Una direccion mal leida no es un error de pantalla: es un mueble que
 * llega a la casa equivocada.
 */

/** Las casillas que necesitan mas de un renglon. */
/*
  Solo "Productos" va como area de texto.

  La direccion es UNA linea -"Cra 45 #12-30, Barrio San Fernando"- y en un area de dos renglones
  se veia como si esperara un parrafo. Lo que si lleva varias lineas es el pedido, que suele ser
  una lista.
*/
const LARGOS: CampoDeFicha[] = ["products"];

export function FichaDeCotizacion({
  contactId,
  conversationId,
}: {
  contactId: string;
  conversationId?: string;
}) {
  const [ficha, setFicha] = useState<FichaDeCotizacion>(fichaVacia);
  const [origenes, setOrigenes] = useState<Origenes>({});
  const [sugerencias, setSugerencias] = useState<Sugerencias>({});
  const [cargando, setCargando] = useState(true);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  // Al cambiar de chat hay que soltar lo del anterior: sin esto quedaban a la vista las
  // sugerencias de un cliente sobre la ficha de otro.
  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setSugerencias({});
    setAviso(null);
    leerFichaDeCotizacionAction(contactId)
      .then((respuesta) => {
        if (!vigente) {
          return;
        }
        setFicha(respuesta.datos?.ficha ?? fichaVacia());
        setOrigenes(respuesta.datos?.origenes ?? {});
      })
      .finally(() => {
        if (vigente) {
          setCargando(false);
        }
      });
    return () => {
      vigente = false;
    };
  }, [contactId]);

  const escribir = useCallback((campo: CampoDeFicha, valor: string) => {
    setFicha((actual) => ({ ...actual, [campo]: valor }));
    // Lo tocado a mano deja de ser "lo dijo el cliente": la frase de respaldo ya no lo respalda.
    setOrigenes((actual) => ({ ...actual, [campo]: { origen: "manual" } }));
  }, []);

  const buscar = async () => {
    setBuscando(true);
    setAviso(null);
    try {
      const respuesta = await buscarDatosEnElChatAction({ contactId, conversationId });
      if (respuesta.error) {
        setAviso(respuesta.error);
        return;
      }
      const halladas = respuesta.sugerencias ?? {};
      setSugerencias(halladas);
      if (Object.keys(halladas).length === 0) {
        setAviso("No encontré esos datos en la conversación. Escribilos a mano.");
      }
    } catch {
      setAviso("No se pudo leer la conversación. Probá de nuevo.");
    } finally {
      setBuscando(false);
    }
  };

  const aceptar = (campo: CampoDeFicha) => {
    const sugerencia = sugerencias[campo];
    if (!sugerencia) {
      return;
    }
    setFicha((actual) => ({ ...actual, [campo]: sugerencia.valor }));
    setOrigenes((actual) => ({
      ...actual,
      [campo]: { origen: "chat", frase: sugerencia.frase, fecha: sugerencia.fecha },
    }));
    descartar(campo);
  };

  const descartar = (campo: CampoDeFicha) => {
    setSugerencias((actual) => {
      const siguiente = { ...actual };
      delete siguiente[campo];
      return siguiente;
    });
  };

  const aceptarTodas = () => {
    for (const campo of CAMPOS_DE_FICHA) {
      if (sugerencias[campo.clave]) {
        aceptar(campo.clave);
      }
    }
  };

  const guardar = async () => {
    setGuardando(true);
    setAviso(null);
    try {
      const respuesta = await guardarFichaDeCotizacionAction({ contactId, ficha, origenes });
      setAviso(respuesta.error ?? "Guardado.");
    } catch {
      setAviso("No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  };

  const copiadoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiar = async () => {
    const texto = CAMPOS_DE_FICHA.map((campo) => `${campo.etiqueta}: ${ficha[campo.clave] || "-"}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      if (copiadoRef.current) {
        clearTimeout(copiadoRef.current);
      }
      copiadoRef.current = setTimeout(() => setCopiado(false), 1800);
    } catch {
      setAviso("El navegador no dejó copiar.");
    }
  };

  useEffect(
    () => () => {
      if (copiadoRef.current) {
        clearTimeout(copiadoRef.current);
      }
    },
    [],
  );

  const cuantasSugerencias = Object.keys(sugerencias).length;

  if (cargando) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 md:px-5">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={buscar}
          disabled={buscando}
          className="gap-1.5"
        >
          {buscando ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {buscando ? "Leyendo el chat…" : "Buscar datos en el chat"}
        </Button>
        {cuantasSugerencias > 1 ? (
          <Button type="button" size="sm" variant="ghost" onClick={aceptarTodas} className="gap-1.5">
            <Check className="size-3.5" />
            Usar los {cuantasSugerencias}
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-5">
        <div className="flex flex-col gap-3.5">
          {CAMPOS_DE_FICHA.map((campo) => {
            const sugerencia = sugerencias[campo.clave];
            const origen = origenes[campo.clave];
            const esLargo = LARGOS.includes(campo.clave);
            return (
              <div key={campo.clave} className="flex flex-col gap-1.5">
                <Label htmlFor={`ficha-${campo.clave}`} className="text-[13px]">
                  {campo.etiqueta}
                </Label>

                {esLargo ? (
                  <Textarea
                    id={`ficha-${campo.clave}`}
                    value={ficha[campo.clave]}
                    onChange={(evento) => escribir(campo.clave, evento.target.value)}
                    placeholder={campo.ejemplo}
                    rows={2}
                    className="resize-none text-sm"
                  />
                ) : (
                  <Input
                    id={`ficha-${campo.clave}`}
                    value={ficha[campo.clave]}
                    onChange={(evento) => escribir(campo.clave, evento.target.value)}
                    placeholder={campo.ejemplo}
                    className="text-sm"
                  />
                )}

                {/*
                  La propuesta va DEBAJO de la casilla y no adentro: adentro se confundiria con un
                  dato ya puesto, y lo que importa es que se vea que todavia no lo es.
                */}
                {sugerencia ? (
                  <div className="rounded-lg border border-primary/40 bg-primary/5 p-2">
                    <p className="text-sm font-medium text-foreground">{sugerencia.valor}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      Lo dijo el cliente: «{sugerencia.frase}»
                      {sugerencia.fecha ? ` · ${formatearFecha(sugerencia.fecha)}` : ""}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => aceptar(campo.clave)}
                        className="h-7 gap-1 px-2 text-xs"
                      >
                        <Check className="size-3.5" />
                        Usar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => descartar(campo.clave)}
                        className="h-7 gap-1 px-2 text-xs"
                      >
                        <X className="size-3.5" />
                        No
                      </Button>
                    </div>
                  </div>
                ) : null}

                {!sugerencia && origen?.origen === "chat" && ficha[campo.clave] ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Salió del chat{origen.frase ? `: «${origen.frase}»` : ""}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2.5 md:px-5">
        <Button type="button" size="sm" onClick={guardar} disabled={guardando} className="gap-1.5">
          {guardando ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
          Guardar
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={copiar} className="gap-1.5">
          <ClipboardCopy className="size-3.5" />
          {copiado ? "Copiado" : "Copiar todo"}
        </Button>
        {aviso ? (
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{aviso}</p>
        ) : null}
      </div>
    </div>
  );
}

function formatearFecha(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) {
    return "";
  }
  return fecha.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}
