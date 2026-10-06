"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Copy, LoaderCircle, MapPin, Plus, Search, SendHorizonal, X } from "lucide-react";

import {
  agregarUbicacionAction,
  buscarUbicacionAction,
  guardarUbicacionEnContactoAction,
  listarProductosParaEnvioAction,
  type ProductoParaEnvio,
} from "@/app/actions/envio-actions";
import type { EstadoDeEnvio, ProductoDeEnvio, UbicacionDeGestion } from "@/lib/envios-gestion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

/**
 * PANEL DE ENVÍO en la ficha del contacto.
 *
 * La asesora escribe la ciudad (o barrio, vereda, corregimiento) y Gestión dice si el envío es
 * gratis, adicional, se cotiza o no llegamos, con UN SOLO TOTAL para el producto elegido. El texto
 * queda listo para insertar en el chat (no se envía solo) o copiar. Lo elegido se guarda en la
 * ficha (`metadata.city` y `metadata.envio`). Si la ubicación no existe, se agrega en Gestión y
 * queda "Se cotiza" hasta que la revisen.
 *
 * Todo es diferido: nada se pide hasta que se abre la ficha, la búsqueda espera 300 ms a que se
 * deje de escribir, y si Gestión no responde se dice sin romper el chat.
 */

const ESPERA_MS = 400;
const MINIMO_LETRAS = 3;
const formatoPesos = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

const INSIGNIA: Record<EstadoDeEnvio, { texto: string; clase: string }> = {
  GRATIS: {
    texto: "Gratis",
    clase: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  ADICIONAL: {
    texto: "Adicional",
    clase: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  COTIZAR: {
    texto: "Se cotiza",
    clase: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  },
  NO_LLEGA: {
    texto: "No llegamos",
    clase: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  },
};

type Busqueda = {
  clave: string;
  error: string | null;
  resultados: UbicacionDeGestion[];
  producto: ProductoDeEnvio | null;
};

function lugarDe(ubicacion: UbicacionDeGestion) {
  if (ubicacion.tipo === "corregimiento" && ubicacion.ciudad && ubicacion.ciudad !== ubicacion.nombre) {
    return `${ubicacion.nombre}, ${ubicacion.ciudad}`;
  }
  return ubicacion.nombre;
}

/** El total con envío para el producto: el que manda Gestión o, si no lo manda, precio + envío. */
function totalDe(ubicacion: UbicacionDeGestion, producto: ProductoDeEnvio | null): number | null {
  const deGestion = ubicacion.cotizacion?.total;
  if (typeof deGestion === "number" && deGestion > 0) return deGestion;
  if (!producto || !(producto.precio > 0)) return null;
  if (ubicacion.envio === "GRATIS") return producto.precio;
  if (ubicacion.envio === "ADICIONAL") {
    const envio = ubicacion.cotizacion?.envio ?? producto.envioAdicional;
    return typeof envio === "number" ? producto.precio + envio : null;
  }
  return null;
}

export function textoDeEnvio(input: {
  estado: EstadoDeEnvio;
  lugar: string;
  producto: string | null;
  total: number | null;
}): string {
  const { lugar, producto, total } = input;
  // Sin total no se inventa un precio: se ofrece cotizar.
  const estado =
    (input.estado === "GRATIS" || input.estado === "ADICIONAL") && (total === null || !producto)
      ? "COTIZAR"
      : input.estado;
  const pesos = total !== null ? formatoPesos.format(total) : "";
  switch (estado) {
    case "GRATIS":
      return `¡Perfecto! A *${lugar}* el envío es *gratis* separando con el *50%* 🚚 Tu *${producto}* queda en *$${pesos}* en total, con garantía de 1 año. ¿De qué *color* lo quieres?`;
    case "ADICIONAL":
      return `¡Claro que llegamos a *${lugar}*! 🚚 Separando con el *50%*, tu *${producto}* queda en *$${pesos}* en total, con envío incluido. ¿De qué *color* lo quieres?`;
    case "COTIZAR":
      return `¡Sí llegamos a *${lugar}*! 🚚 Déjame cotizarte el envío y en un momento te doy el *total exacto*. Mientras tanto, ¿de qué *color* lo quieres?`;
    case "NO_LLEGA":
      return `Por ahora no tenemos envío a *${lugar}* 🙏 ¿Tienes una ciudad cercana donde lo podamos entregar?`;
  }
}

function InsigniaDeEnvio({ estado }: { estado: EstadoDeEnvio }) {
  return <Badge className={cn("h-5", INSIGNIA[estado].clase)}>{INSIGNIA[estado].texto}</Badge>;
}

/** Busca con espera de 400 ms; devuelve la última respuesta que corresponde a la clave actual. */
function useBusquedaDiferida(q: string, producto: string | null, soloCiudades: boolean) {
  const texto = q.trim();
  const clave = texto.length >= MINIMO_LETRAS ? `${texto.toLowerCase()}|${producto ?? ""}` : "";
  const [busqueda, setBusqueda] = useState<Busqueda | null>(null);

  useEffect(() => {
    if (!clave) return;
    let cancelado = false;
    const espera = window.setTimeout(() => {
      buscarUbicacionAction(texto, producto)
        .catch(() => ({ error: "No se pudo consultar Gestión" }) as const)
        .then((resultado) => {
          if (cancelado) return;
          if ("error" in resultado) {
            setBusqueda({ clave, error: resultado.error, resultados: [], producto: null });
            return;
          }
          setBusqueda({
            clave,
            error: null,
            resultados: soloCiudades
              ? resultado.resultados.filter((fila) => fila.tipo === "ciudad")
              : resultado.resultados,
            producto: resultado.producto,
          });
        });
    }, ESPERA_MS);
    return () => {
      cancelado = true;
      window.clearTimeout(espera);
    };
  }, [clave, texto, producto, soloCiudades]);

  const vigente = busqueda && busqueda.clave === clave ? busqueda : null;
  return { activa: Boolean(clave), cargando: Boolean(clave) && !vigente, busqueda: vigente };
}

export function PanelDeEnvio({
  contactId,
  chatKey,
  contactCity,
  puedeEscribir,
  onInsertar,
  onCiudadGuardada,
}: {
  contactId: string | null;
  chatKey: string | null;
  contactCity: string;
  puedeEscribir: boolean;
  onInsertar: (texto: string) => void;
  onCiudadGuardada?: (city: string) => void;
}) {
  const [productos, setProductos] = useState<ProductoParaEnvio[] | null>(null);
  const [productoCodigo, setProductoCodigo] = useState<string>("");
  const [query, setQuery] = useState("");
  // Lo que de verdad se busca: solo cambia cuando la asesora escribe, presiona Enter o la lupa.
  const [consulta, setConsulta] = useState("");
  const [semillaUsada, setSemillaUsada] = useState(false);
  const [elegido, setElegido] = useState<{ ubicacion: UbicacionDeGestion; producto: ProductoDeEnvio | null } | null>(
    null,
  );
  const [agregando, setAgregando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [ciudadQuery, setCiudadQuery] = useState("");
  const [ciudadElegida, setCiudadElegida] = useState<UbicacionDeGestion | null>(null);
  const [guardandoNueva, setGuardandoNueva] = useState(false);
  const ultimoGuardado = useRef<string>("");

  // La ciudad que ya tiene la ficha solo pre-llena el cuadro (una sola vez): no dispara la búsqueda.
  // Se ajusta durante el render porque la ciudad puede llegar después de montar.
  if (!semillaUsada && contactCity.trim()) {
    setSemillaUsada(true);
    setQuery(contactCity.split(",")[0]?.trim() ?? "");
  }

  useEffect(() => {
    let cancelado = false;
    listarProductosParaEnvioAction(chatKey)
      .catch(() => ({ error: "No se pudieron cargar los productos" }) as const)
      .then((resultado) => {
        if (cancelado) return;
        if ("error" in resultado) {
          setProductos([]);
          return;
        }
        setProductos(resultado.productos);
        setProductoCodigo((actual) => actual || resultado.porDefecto || "");
      });
    return () => {
      cancelado = true;
    };
  }, [chatKey]);

  // Se espera a tener los productos para no consultar dos veces (sin producto y con el de defecto).
  const principal = useBusquedaDiferida(
    elegido || agregando || productos === null ? "" : consulta,
    productoCodigo || null,
    false,
  );
  const ciudades = useBusquedaDiferida(agregando && !ciudadElegida ? ciudadQuery : "", null, true);

  const nombreDelProducto = useMemo(() => {
    if (elegido?.producto?.nombre) return elegido.producto.nombre;
    return productos?.find((producto) => producto.codigo === productoCodigo)?.nombre ?? null;
  }, [elegido, productos, productoCodigo]);

  const texto = elegido
    ? textoDeEnvio({
        estado: elegido.ubicacion.envio,
        lugar: lugarDe(elegido.ubicacion),
        producto: nombreDelProducto,
        total: totalDe(elegido.ubicacion, elegido.producto),
      })
    : "";
  const sinTotal =
    elegido &&
    (elegido.ubicacion.envio === "GRATIS" || elegido.ubicacion.envio === "ADICIONAL") &&
    (totalDe(elegido.ubicacion, elegido.producto) === null || !nombreDelProducto);

  const guardarEnContacto = (ubicacion: UbicacionDeGestion) => {
    if (!contactId) return;
    const clave = `${contactId}|${ubicacion.id}|${ubicacion.envio}`;
    if (ultimoGuardado.current === clave) return;
    ultimoGuardado.current = clave;
    void guardarUbicacionEnContactoAction({
      contactId,
      lugar: lugarDe(ubicacion),
      departamento: ubicacion.departamento,
      envio: ubicacion.envio,
      gestionId: ubicacion.id,
    })
      .then((resultado) => {
        if ("error" in resultado) {
          ultimoGuardado.current = "";
          // En modo monitoreo no se guarda, y no hace falta gritarlo: el panel igual sirve para mirar.
          if (puedeEscribir) toast.error(resultado.error);
          return;
        }
        onCiudadGuardada?.(resultado.city);
      })
      .catch(() => {
        ultimoGuardado.current = "";
      });
  };

  const elegir = (ubicacion: UbicacionDeGestion, producto: ProductoDeEnvio | null) => {
    setElegido({ ubicacion, producto });
    guardarEnContacto(ubicacion);
  };

  const cambiarProducto = (codigo: string) => {
    setProductoCodigo(codigo);
    // El total depende del producto: se vuelve a la lista para pedirlo de nuevo.
    if (elegido) {
      setQuery(elegido.ubicacion.nombre);
      setConsulta(elegido.ubicacion.nombre);
      setElegido(null);
    }
  };

  const abrirAgregar = () => {
    setAgregando(true);
    setNombreNuevo(query.trim());
    setCiudadQuery("");
    setCiudadElegida(null);
  };

  const cerrarAgregar = () => {
    setAgregando(false);
    setCiudadElegida(null);
  };

  const guardarUbicacionNueva = async () => {
    const nombre = nombreNuevo.trim();
    if (nombre.length < 2 || !ciudadElegida) {
      toast.error("Escribe el nombre y elige la ciudad");
      return;
    }
    setGuardandoNueva(true);
    try {
      const resultado = await agregarUbicacionAction({ cityId: ciudadElegida.cityId || ciudadElegida.id, nombre });
      if ("error" in resultado) {
        toast.error(resultado.error);
        return;
      }
      toast.success(resultado.creado ? "Ubicación agregada, pendiente de revisar" : "Esa ubicación ya existía en Gestión");
      const nueva: UbicacionDeGestion = {
        tipo: "corregimiento",
        id: resultado.id,
        cityId: ciudadElegida.cityId || ciudadElegida.id,
        nombre: resultado.nombre || nombre,
        ciudad: ciudadElegida.nombre,
        departamento: ciudadElegida.departamento,
        envio: "COTIZAR",
        pendienteRevision: resultado.creado,
        exacta: true,
        cotizacion: null,
      };
      setAgregando(false);
      setCiudadElegida(null);
      elegir(nueva, null);
    } catch {
      toast.error("No se pudo consultar Gestión");
    } finally {
      setGuardandoNueva(false);
    }
  };

  const insertar = () => {
    if (!texto) return;
    if (!puedeEscribir) {
      toast.error("No hay cuadro de mensaje en este chat");
      return;
    }
    onInsertar(texto);
  };

  const copiar = () => {
    if (!texto) return;
    void navigator.clipboard
      ?.writeText(texto)
      .then(() => toast.success("Copiado"))
      .catch(() => toast.error("No se pudo copiar"));
  };

  return (
    <div className="space-y-2">
      {productos && productos.length > 0 ? (
        <NativeSelect
          size="sm"
          className="w-full"
          value={productoCodigo}
          onChange={(event) => cambiarProducto(event.target.value)}
          aria-label="Producto"
        >
          <NativeSelectOption value="">Sin producto</NativeSelectOption>
          {productos.map((producto) => (
            <NativeSelectOption key={producto.codigo} value={producto.codigo}>
              {producto.nombre}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : null}

      {elegido ? (
        <div className="space-y-2 rounded-lg border border-border p-2.5">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{lugarDe(elegido.ubicacion)}</p>
              {elegido.ubicacion.departamento ? (
                <p className="truncate text-xs text-muted-foreground">{elegido.ubicacion.departamento}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setQuery(elegido.ubicacion.nombre);
                setConsulta(elegido.ubicacion.nombre);
                setElegido(null);
              }}
              aria-label="Buscar otra ubicación"
              title="Buscar otra"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <InsigniaDeEnvio estado={elegido.ubicacion.envio} />
            {elegido.ubicacion.pendienteRevision ? (
              <span className="text-xs text-muted-foreground">pendiente de revisar</span>
            ) : null}
          </div>
          {sinTotal ? (
            <p className="text-xs text-muted-foreground">
              Sin total para este producto: el texto ofrece cotizar. Elige un producto para ver el total.
            </p>
          ) : null}
          <p className="whitespace-pre-wrap rounded-md bg-muted/60 px-2.5 py-2 text-[13px] leading-snug text-foreground">
            {texto}
          </p>
          {/* Decision de Alex: el envio gratis aplica solo separando con el 50%. Nota para la asesora, no va en el texto. */}
          {elegido.ubicacion.envio !== "NO_LLEGA" ? (
            <p className="text-xs text-muted-foreground">
              Si pide contraentrega: paga por adelantado el flete real (cotízalo con Ingrid) y el producto al recibir.
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" className="flex-1 gap-1.5" onClick={insertar} disabled={!puedeEscribir}>
              <SendHorizonal className="h-3.5 w-3.5" />
              Insertar en el chat
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={copiar}>
              <Copy className="h-3.5 w-3.5" />
              Copiar
            </Button>
          </div>
        </div>
      ) : agregando ? (
        <div className="space-y-2 rounded-lg border border-border p-2.5">
          <p className="text-xs font-medium text-foreground">Agregar ubicación nueva</p>
          <Input
            value={nombreNuevo}
            onChange={(event) => setNombreNuevo(event.target.value)}
            placeholder="Barrio, vereda o corregimiento"
            maxLength={120}
          />
          {ciudadElegida ? (
            <div className="flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {ciudadElegida.nombre}
                {ciudadElegida.departamento ? `, ${ciudadElegida.departamento}` : ""}
              </span>
              <button
                type="button"
                onClick={() => setCiudadElegida(null)}
                aria-label="Cambiar ciudad"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <>
              <Input
                value={ciudadQuery}
                onChange={(event) => setCiudadQuery(event.target.value)}
                placeholder="¿A qué ciudad pertenece?"
              />
              <ListaDeUbicaciones
                {...ciudades}
                vacio="No encontramos esa ciudad"
                onElegir={(ubicacion) => setCiudadElegida(ubicacion)}
              />
            </>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="flex-1"
              onClick={() => void guardarUbicacionNueva()}
              disabled={guardandoNueva || !ciudadElegida || nombreNuevo.trim().length < 2 || !puedeEscribir}
            >
              {guardandoNueva ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
              Agregar
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={cerrarAgregar} disabled={guardandoNueva}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative">
            <button
              type="button"
              onClick={() => setConsulta(query)}
              aria-label="Buscar"
              title="Buscar"
              className="absolute top-1/2 left-1.5 z-10 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
            <Input
              value={query}
              onChange={(event) => {
                setSemillaUsada(true);
                setQuery(event.target.value);
                setConsulta(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  setConsulta(query);
                }
              }}
              placeholder="Ciudad, barrio o corregimiento"
              className="pl-8"
              aria-label="Buscar ubicación de envío"
            />
          </div>
          <ListaDeUbicaciones
            {...principal}
            vacio="No encontramos esa ubicación"
            onElegir={(ubicacion) => elegir(ubicacion, principal.busqueda?.producto ?? null)}
          />
          {principal.busqueda && !principal.busqueda.error && principal.busqueda.resultados.length === 0 ? (
            <Button type="button" size="sm" variant="outline" className="w-full gap-1.5" onClick={abrirAgregar}>
              <Plus className="h-3.5 w-3.5" />
              Agregar ubicación nueva
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

function ListaDeUbicaciones({
  activa,
  cargando,
  busqueda,
  vacio,
  onElegir,
}: {
  activa: boolean;
  cargando: boolean;
  busqueda: Busqueda | null;
  vacio: string;
  onElegir: (ubicacion: UbicacionDeGestion) => void;
}) {
  if (!activa) return null;
  if (cargando) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        Consultando Gestión…
      </p>
    );
  }
  if (!busqueda) return null;
  if (busqueda.error) {
    return <p className="text-xs text-muted-foreground">{busqueda.error}</p>;
  }
  if (busqueda.resultados.length === 0) {
    return <p className="text-xs text-muted-foreground">{vacio}</p>;
  }
  return (
    <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
      {busqueda.resultados.map((ubicacion) => (
        <li key={`${ubicacion.tipo}:${ubicacion.id}`}>
          <button
            type="button"
            onClick={() => onElegir(ubicacion)}
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition hover:bg-muted"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">{lugarDe(ubicacion)}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {ubicacion.departamento}
                {ubicacion.pendienteRevision ? " · pendiente de revisar" : ""}
              </span>
            </span>
            <InsigniaDeEnvio estado={ubicacion.envio} />
          </button>
        </li>
      ))}
    </ul>
  );
}
