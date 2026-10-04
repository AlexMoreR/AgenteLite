"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ClipboardCopy, LoaderCircle, Pencil, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

/** Clientes cuyo chat ya se leyo solo en esta sesion (la precarga va una vez por cliente). */
const yaSeBuscoEnEstaSesion = new Set<string>();

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
  // La ficha se ve como tarjeta y se edita en un modal. Al abrirlo se guarda una copia: si se
  // cierra sin guardar, la tarjeta vuelve a lo guardado y no a lo que quedo a medias.
  const [editando, setEditando] = useState(false);
  const copiaAlAbrir = useRef<{ ficha: FichaDeCotizacion; origenes: Origenes } | null>(null);

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
        const guardada = respuesta.datos?.ficha ?? fichaVacia();
        setFicha(guardada);
        setOrigenes(respuesta.datos?.origenes ?? {});

        /*
          PRECARGA: con la ficha vacia, la app lee el chat sola y PROPONE lo que encuentra
          (Alex, 04-10-2026). No guarda nada: igual hay que tocar "Usar" y "Guardar", porque una
          direccion mal leida es un mueble en la casa equivocada. Una vez por cliente y por sesion,
          para no pagar la lectura cada vez que se abre la pestaña.
        */
        const vacia = CAMPOS_DE_FICHA.every((campo) => !guardada[campo.clave].trim());
        if (vacia && !yaSeBuscoEnEstaSesion.has(contactId)) {
          yaSeBuscoEnEstaSesion.add(contactId);
          setBuscando(true);
          buscarDatosEnElChatAction({ contactId, conversationId })
            .then((encontrado) => {
              if (vigente && !encontrado.error) {
                setSugerencias(encontrado.sugerencias ?? {});
              }
            })
            .catch(() => undefined)
            .finally(() => {
              if (vigente) {
                setBuscando(false);
              }
            });
        }
      })
      .finally(() => {
        if (vigente) {
          setCargando(false);
        }
      });
    return () => {
      vigente = false;
      setBuscando(false);
    };
    // conversationId acompaña al contacto: no hace falta volver a leer si solo cambia el chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        setAviso("No encontré esos datos en la conversación. Escríbelos a mano.");
      }
    } catch {
      setAviso("No se pudo leer la conversación. Prueba de nuevo.");
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
      if (respuesta.error) {
        setAviso(respuesta.error);
        return;
      }
      copiaAlAbrir.current = null;
      setSugerencias({});
      setEditando(false);
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

  const abrirEditor = () => {
    copiaAlAbrir.current = { ficha, origenes };
    setAviso(null);
    setEditando(true);
  };

  const cerrarEditor = (abierto: boolean) => {
    if (abierto) {
      return;
    }
    if (copiaAlAbrir.current) {
      setFicha(copiaAlAbrir.current.ficha);
      setOrigenes(copiaAlAbrir.current.origenes);
      copiaAlAbrir.current = null;
    }
    // Las propuestas sin revisar se quedan: "Cancelar" no es "No" a lo que encontro el chat.
    setAviso(null);
    setEditando(false);
  };

  const hayDatos = CAMPOS_DE_FICHA.some((campo) => ficha[campo.clave].trim());
  const lugar = [ficha.city, ficha.department]
    .map((parte) => parte.trim())
    .filter(Boolean)
    .join(", ");

  return (
    <div className="h-full overflow-y-auto px-3 py-3 md:px-5">
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Datos de la clienta
            </p>
            <p className="mt-0.5 truncate text-base font-semibold text-foreground">
              {ficha.fullName.trim() || "Sin nombre"}
            </p>
            {ficha.document.trim() ? (
              <p className="text-[13px] text-muted-foreground">NIT / CC {ficha.document}</p>
            ) : null}
          </div>
          {hayDatos ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={copiar}
              aria-label="Copiar todos los datos"
              title={copiado ? "Copiado" : "Copiar todo"}
              className="size-8 shrink-0"
            >
              {copiado ? <Check className="size-4 text-emerald-600" /> : <ClipboardCopy className="size-4" />}
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={abrirEditor}
            aria-label="Editar datos de la clienta"
            className="size-8 shrink-0"
          >
            <Pencil className="size-4" />
          </Button>
        </div>

        {hayDatos ? (
          <dl className="mt-3 grid gap-2.5 border-t border-border pt-3 text-sm">
            <DatoDeLaFicha etiqueta="Correo" valor={ficha.email} />
            <DatoDeLaFicha etiqueta="Ciudad" valor={lugar} />
            <DatoDeLaFicha etiqueta="Dirección" valor={ficha.address} />
            <DatoDeLaFicha etiqueta="Productos" valor={ficha.products} varias />
          </dl>
        ) : buscando ? (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-[13px] text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" />
            Buscando sus datos en el chat…
          </p>
        ) : cuantasSugerencias > 0 ? (
          <button
            type="button"
            onClick={abrirEditor}
            className="mt-3 flex w-full items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-3 text-left text-[13px] text-foreground transition-colors hover:bg-primary/10"
          >
            <Sparkles className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              Encontré {cuantasSugerencias === 1 ? "1 dato" : `${cuantasSugerencias} datos`} en el chat.
            </span>
            <span className="font-medium text-primary">Revisar</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={abrirEditor}
            className="mt-3 w-full rounded-xl border border-dashed border-border px-3 py-3 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted/60"
          >
            Aún no hay datos para cotizar. Toca para agregarlos o buscarlos en el chat.
          </button>
        )}

        {aviso && !editando ? <p className="mt-2 text-xs text-muted-foreground">{aviso}</p> : null}
      </section>

      <Dialog open={editando} onOpenChange={cerrarEditor}>
        <DialogContent className="gap-3 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Datos de la clienta</DialogTitle>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
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

          {aviso ? <p className="text-xs text-muted-foreground">{aviso}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => cerrarEditor(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={guardar} disabled={guardando} className="gap-1.5">
              {guardando ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DatoDeLaFicha({
  etiqueta,
  valor,
  varias = false,
}: {
  etiqueta: string;
  valor: string;
  varias?: boolean;
}) {
  const limpio = valor.trim();
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2">
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd
        className={`min-w-0 ${limpio ? "text-foreground" : "text-muted-foreground"} ${
          varias ? "whitespace-pre-line" : "truncate"
        }`}
      >
        {limpio || "—"}
      </dd>
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
