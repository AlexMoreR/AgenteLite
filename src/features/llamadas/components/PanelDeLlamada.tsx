"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, GripVertical, Mic, MicOff, Minimize2, PhoneOff } from "lucide-react";

import { ContactAvatar } from "@/components/chats/contact-avatar";
import {
  ajustarDentroDePantalla,
  CLAVE_DEL_CUADRO,
  escribirPreferencia,
  posicionPorDefecto,
  tamanoDeLaForma,
  type FormaDelCuadro,
  type Posicion,
  type PreferenciaDelCuadro,
  type Ventana,
} from "./posicion-del-cuadro";
import type { EstadoLlamada } from "./useLlamada";

/**
 * La llamada en curso, con tres formas.
 *
 * Arranca en PANTALLA COMPLETA —foto grande, cronómetro, botones grandes— porque cuando una
 * llamada empieza es lo único que importa y hay que poder colgar sin apuntar a un botón de nueve
 * píxeles. Y se MINIMIZA cuando la asesora necesita volver a leer el chat, que es la mitad de la
 * razón de tener el teléfono adentro del CRM: a una TARJETA o a una BURBUJA que se arrastran a
 * donde no estorben (antes la barra quedaba fija abajo y tapaba la caja de escribir).
 *
 * No hay botón de "Altavoz": el navegador de un celular no deja elegir por dónde sale el audio
 * (eso es cosa del sistema), así que un botón ahí sería un adorno que no hace nada.
 */

export function PanelDeLlamada({
  estado,
  nombre,
  telefono,
  avatarUrl,
  silenciado,
  segundos,
  motivoFin,
  recienContesto,
  expandido,
  cuadro,
  onCambiarCuadro,
  onMinimizar,
  onExpandir,
  onColgar,
  onAlternarSilencio,
}: {
  estado: EstadoLlamada;
  nombre: string;
  telefono: string;
  avatarUrl?: string | null;
  silenciado: boolean;
  segundos: number;
  /** Como termino la llamada, mientras el panel lo muestra antes de cerrarse. */
  motivoFin?: string | null;
  /** El cliente acaba de contestar: se dice "Contesto" junto al reloj. */
  recienContesto?: boolean;
  expandido: boolean;
  /** Dónde y en qué forma va el cuadro minimizado. `null` mientras no se ha leído lo guardado. */
  cuadro: PreferenciaDelCuadro | null;
  onCambiarCuadro: (cuadro: PreferenciaDelCuadro) => void;
  onMinimizar: () => void;
  onExpandir: () => void;
  onColgar: () => void;
  onAlternarSilencio: () => void;
}) {
  if (estado === "libre") {
    return null;
  }

  const detalle = textoDeEstado(estado, segundos, motivoFin ?? null, Boolean(recienContesto));

  if (!expandido) {
    return (
      <CuadroMinimizado
        estado={estado}
        nombre={nombre}
        avatarUrl={avatarUrl}
        silenciado={silenciado}
        detalle={detalle}
        recienContesto={Boolean(recienContesto)}
        cuadro={cuadro}
        onCambiarCuadro={onCambiarCuadro}
        onExpandir={onExpandir}
        onColgar={onColgar}
        onAlternarSilencio={onAlternarSilencio}
      />
    );
  }

  return (
    /**
     * Fondo oscuro fijo, no el del tema: una llamada es un estado excepcional y conviene que se
     * note de un vistazo que la pantalla está "tomada". Es la misma convención de cualquier app
     * de teléfono.
     */
    <div className="fixed inset-0 z-[60] flex flex-col items-center bg-slate-900 text-white">
      <div className="flex w-full items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onMinimizar}
          aria-label="Minimizar la llamada y volver al chat"
          title="Volver al chat"
          className="inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
        >
          <ChevronDown className="size-6" />
        </button>
        <span className="text-xs text-white/60">Llamada de WhatsApp</span>
        <span className="size-11" aria-hidden="true" />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <ContactAvatar
          avatarUrl={avatarUrl ?? null}
          label={nombre}
          className="size-32 rounded-full border-2 border-white/15 bg-white/10 text-3xl text-white"
          fallbackClassName="rounded-full bg-white/10 text-white"
        />
        <div className="space-y-1">
          <h2 className="text-balance text-2xl font-semibold">{nombre}</h2>
          {telefono && telefono !== nombre ? <p className="text-sm tabular-nums text-white/50">{telefono}</p> : null}
          {/*
            El estado se tiene que leer de lejos: la asesora esta con la diadema mirando el chat,
            no el panel. Amarillo mientras timbra, verde cuando contesta, rojo cuando termina.
          */}
          <p
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium tabular-nums ${
              estado === "hablando"
                ? recienContesto
                  ? "bg-emerald-500 text-white"
                  : "bg-emerald-500/15 text-emerald-300"
                : estado === "terminada"
                  ? "bg-rose-500/20 text-rose-200"
                  : "bg-amber-500/15 text-amber-200"
            }`}
          >
            {estado === "sonando" || estado === "marcando" ? (
              <span className="inline-block size-2 shrink-0 animate-pulse rounded-full bg-amber-400" aria-hidden="true" />
            ) : null}
            {detalle}
          </p>
        </div>
      </div>

      <div className="flex w-full items-center justify-center gap-10 px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onAlternarSilencio}
            disabled={estado !== "hablando"}
            aria-pressed={silenciado}
            className={`inline-flex size-16 items-center justify-center rounded-full transition disabled:opacity-40 ${
              silenciado ? "bg-white text-slate-900" : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            {silenciado ? <MicOff className="size-6" /> : <Mic className="size-6" />}
          </button>
          <span className="text-xs text-white/70">{silenciado ? "Silenciado" : "Silenciar"}</span>
        </div>

        <div className="flex flex-col items-center gap-2">
          <BotonColgar onClick={onColgar} tamano="grande" />
          <span className="text-xs text-white/70">Finalizar</span>
        </div>
      </div>
    </div>
  );
}

/** Cuántos píxeles hay que mover el dedo o el mouse para que cuente como arrastre y no como toque. */
const UMBRAL_DE_ARRASTRE = 6;

function leerVentana(): Ventana {
  return { anchoVentana: window.innerWidth, altoVentana: window.innerHeight };
}

/** Se guarda por equipo. Si el navegador no deja (modo privado, sin espacio), solo no se recuerda. */
function guardarCuadro(cuadro: PreferenciaDelCuadro) {
  try {
    window.localStorage.setItem(CLAVE_DEL_CUADRO, escribirPreferencia(cuadro));
  } catch {
    // Sin localStorage el cuadro funciona igual; la próxima vez arranca arriba a la derecha.
  }
}

function claseDelPunto(estado: EstadoLlamada) {
  if (estado === "hablando") {
    return "bg-emerald-500";
  }
  if (estado === "terminada") {
    return "bg-rose-500";
  }
  // Marcando, timbrando o cortando: todavía no hay conversación.
  return "bg-amber-500 animate-pulse";
}

/**
 * Arrastrar con mouse o con el dedo (pointer events). Mientras se arrastra, la posición vive acá;
 * al soltar se ajusta a la pantalla y se entrega UNA vez, para no escribir localStorage a cada
 * píxel. Un movimiento menor al umbral no es arrastre: el `click` que sigue pasa normal.
 */
function useArrastre({
  posicion,
  tamano,
  onSoltar,
}: {
  posicion: Posicion;
  tamano: { ancho: number; alto: number };
  onSoltar: (posicion: Posicion) => void;
}) {
  const [enArrastre, setEnArrastre] = useState<Posicion | null>(null);
  const inicio = useRef<{ id: number; px: number; py: number; x: number; y: number; movido: boolean } | null>(null);
  const ultima = useRef<Posicion | null>(null);
  // El click que el navegador manda después de soltar un arrastre no tiene que contar como toque.
  const ignorarClick = useRef(false);

  const terminar = (evento: React.PointerEvent<HTMLElement>) => {
    const datos = inicio.current;
    if (!datos || datos.id !== evento.pointerId) {
      return;
    }
    if (evento.currentTarget.hasPointerCapture(evento.pointerId)) {
      evento.currentTarget.releasePointerCapture(evento.pointerId);
    }
    inicio.current = null;
    if (datos.movido && ultima.current) {
      ignorarClick.current = true;
      onSoltar(ajustarDentroDePantalla(ultima.current, tamano, leerVentana()));
    }
    ultima.current = null;
    setEnArrastre(null);
  };

  const manejadores = {
    onPointerDown: (evento: React.PointerEvent<HTMLElement>) => {
      // Con el mouse solo el botón izquierdo; con el dedo o el lápiz, cualquier toque.
      if (evento.pointerType === "mouse" && evento.button !== 0) {
        return;
      }
      evento.currentTarget.setPointerCapture(evento.pointerId);
      ignorarClick.current = false;
      inicio.current = {
        id: evento.pointerId,
        px: evento.clientX,
        py: evento.clientY,
        x: posicion.x,
        y: posicion.y,
        movido: false,
      };
    },
    onPointerMove: (evento: React.PointerEvent<HTMLElement>) => {
      const datos = inicio.current;
      if (!datos || datos.id !== evento.pointerId) {
        return;
      }
      const dx = evento.clientX - datos.px;
      const dy = evento.clientY - datos.py;
      if (!datos.movido && Math.hypot(dx, dy) < UMBRAL_DE_ARRASTRE) {
        return;
      }
      datos.movido = true;
      const nueva = ajustarDentroDePantalla({ x: datos.x + dx, y: datos.y + dy }, tamano, leerVentana());
      ultima.current = nueva;
      setEnArrastre(nueva);
    },
    onPointerUp: terminar,
    onPointerCancel: terminar,
    onClickCapture: (evento: React.MouseEvent<HTMLElement>) => {
      if (ignorarClick.current) {
        ignorarClick.current = false;
        evento.preventDefault();
        evento.stopPropagation();
      }
    },
  };

  return { posicionActual: enArrastre ?? posicion, arrastrando: enArrastre !== null, manejadores };
}

function CuadroMinimizado({
  estado,
  nombre,
  avatarUrl,
  silenciado,
  detalle,
  recienContesto,
  cuadro,
  onCambiarCuadro,
  onExpandir,
  onColgar,
  onAlternarSilencio,
}: {
  estado: EstadoLlamada;
  nombre: string;
  avatarUrl?: string | null;
  silenciado: boolean;
  detalle: string;
  recienContesto: boolean;
  cuadro: PreferenciaDelCuadro | null;
  onCambiarCuadro: (cuadro: PreferenciaDelCuadro) => void;
  onExpandir: () => void;
  onColgar: () => void;
  onAlternarSilencio: () => void;
}) {
  // Este cuadro solo se dibuja en el navegador (hay llamada solo después de que la asesora marca),
  // así que acá ya se puede leer el tamaño de la ventana.
  const [ventana, setVentana] = useState<Ventana>(() => leerVentana());
  const actual = cuadro ?? posicionPorDefecto(ventana);
  const tamano = tamanoDeLaForma(actual.forma, ventana);
  // Lo guardado puede venir de una pantalla más grande: siempre se dibuja ya ajustado.
  const ajustada = ajustarDentroDePantalla(actual, tamano, ventana);

  // Al cambiar el tamaño de la ventana (girar el celular, achicar el navegador) el cuadro se
  // vuelve a meter en la pantalla. No se guarda: lo guardado es lo que la asesora eligió.
  useEffect(() => {
    const alCambiarTamano = () => setVentana(leerVentana());
    window.addEventListener("resize", alCambiarTamano);
    return () => window.removeEventListener("resize", alCambiarTamano);
  }, []);

  const elegir = (siguiente: PreferenciaDelCuadro) => {
    const tamanoSiguiente = tamanoDeLaForma(siguiente.forma, leerVentana());
    const final = { ...ajustarDentroDePantalla(siguiente, tamanoSiguiente, leerVentana()), forma: siguiente.forma };
    guardarCuadro(final);
    onCambiarCuadro(final);
  };

  const cambiarForma = (forma: FormaDelCuadro) => {
    // Se conserva el borde más cercano: una tarjeta pegada a la derecha se vuelve una burbuja
    // pegada a la derecha, y no una burbuja donde empezaba la tarjeta.
    const tamanoSiguiente = tamanoDeLaForma(forma, ventana);
    const pegadaALaDerecha = ajustada.x + tamano.ancho / 2 > ventana.anchoVentana / 2;
    const x = pegadaALaDerecha ? ajustada.x + tamano.ancho - tamanoSiguiente.ancho : ajustada.x;
    elegir({ x, y: ajustada.y, forma });
  };

  const { posicionActual, arrastrando, manejadores } = useArrastre({
    posicion: ajustada,
    tamano,
    onSoltar: (posicion) => elegir({ ...posicion, forma: actual.forma }),
  });

  const sombra = arrastrando
    ? "shadow-[0_28px_70px_-20px_rgba(15,23,42,0.6)]"
    : "shadow-[0_24px_60px_-24px_rgba(15,23,42,0.45)]";

  if (actual.forma === "burbuja") {
    return (
      <div
        className="fixed z-[60]"
        style={{ left: posicionActual.x, top: posicionActual.y, width: tamano.ancho, height: tamano.alto }}
      >
        {/*
          Toda la burbuja se agarra para moverla; tocarla sin moverla la vuelve tarjeta.
          touch-none solo acá: en el celular el dedo mueve la burbuja y no la página.
        */}
        <button
          type="button"
          {...manejadores}
          onClick={() => cambiarForma("tarjeta")}
          aria-label={`Llamada con ${nombre}: ${detalle}. Tocar para ver la tarjeta`}
          title="Mover o tocar para ver la llamada"
          className={`relative size-full touch-none select-none rounded-full border-2 border-card bg-card ${sombra} ${
            arrastrando ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          <ContactAvatar
            avatarUrl={avatarUrl ?? null}
            label={nombre}
            className="pointer-events-none size-full rounded-full bg-muted text-muted-foreground"
            fallbackClassName="rounded-full bg-muted text-muted-foreground"
          />
          <span
            className={`pointer-events-none absolute left-0.5 top-0.5 size-3.5 rounded-full border-2 border-card ${claseDelPunto(estado)}`}
            aria-hidden="true"
          />
        </button>
        <span className="absolute -bottom-1 -right-1">
          <BotonColgar onClick={onColgar} tamano="burbuja" />
        </span>
      </div>
    );
  }

  return (
    <div
      className={`fixed z-[60] flex items-center gap-2 rounded-2xl border border-border bg-card py-2.5 pr-3 ${sombra}`}
      style={{ left: posicionActual.x, top: posicionActual.y, width: tamano.ancho, height: tamano.alto }}
    >
      {/*
        La agarradera. touch-none SOLO acá: en el celular arrastrar desde aquí no mueve la página,
        y el resto de la tarjeta sigue respondiendo como siempre.
      */}
      <span
        {...manejadores}
        role="presentation"
        title="Arrastrar para mover"
        className={`flex h-full shrink-0 touch-none select-none items-center pl-1.5 text-muted-foreground ${
          arrastrando ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </span>

      {/* Toda la zona del nombre vuelve a la pantalla grande: es el gesto que uno intenta. */}
      <button
        type="button"
        onClick={onExpandir}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label="Volver a la llamada"
      >
        <ContactAvatar
          avatarUrl={avatarUrl ?? null}
          label={nombre}
          className="h-10 w-10 shrink-0 rounded-full border border-border bg-muted text-muted-foreground"
          fallbackClassName="rounded-full bg-muted text-muted-foreground"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{nombre}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`inline-block size-1.5 shrink-0 rounded-full ${claseDelPunto(estado)}`} aria-hidden="true" />
            <span
              className={`truncate tabular-nums ${
                estado === "hablando" && recienContesto
                  ? "font-semibold text-emerald-600 dark:text-emerald-400"
                  : estado === "terminada"
                    ? "font-semibold text-rose-600 dark:text-rose-400"
                    : ""
              }`}
            >
              {detalle}
            </span>
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => cambiarForma("burbuja")}
        title="Hacer burbuja"
        aria-label="Achicar la llamada a una burbuja"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-muted"
      >
        <Minimize2 className="size-4" />
      </button>
      <BotonMicrofono silenciado={silenciado} activo={estado === "hablando"} onClick={onAlternarSilencio} />
      <BotonColgar onClick={onColgar} tamano="chico" />
    </div>
  );
}

function BotonMicrofono({
  silenciado,
  activo,
  onClick,
}: {
  silenciado: boolean;
  activo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!activo}
      aria-pressed={silenciado}
      title={silenciado ? "Activar el micrófono" : "Silenciar mi micrófono"}
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full border transition disabled:opacity-40 ${
        silenciado
          ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
          : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {silenciado ? <MicOff className="size-4" /> : <Mic className="size-4" />}
    </button>
  );
}

function BotonColgar({ onClick, tamano }: { onClick: () => void; tamano: "chico" | "grande" | "burbuja" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Colgar"
      aria-label="Colgar"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-rose-600 text-white transition hover:bg-rose-700 ${
        tamano === "grande" ? "size-16" : tamano === "burbuja" ? "size-7 border-2 border-card" : "size-9"
      }`}
    >
      <PhoneOff className={tamano === "grande" ? "size-6" : tamano === "burbuja" ? "size-3.5" : "size-4"} />
    </button>
  );
}

function textoDeEstado(estado: EstadoLlamada, segundos: number, motivoFin: string | null, recienContesto: boolean) {
  if (estado === "hablando") {
    const minutos = Math.floor(segundos / 60);
    const resto = segundos % 60;
    const reloj = `${minutos}:${String(resto).padStart(2, "0")}`;
    return recienContesto ? `Contestó · ${reloj}` : reloj;
  }
  if (estado === "terminada") {
    return motivoFin || "Llamada terminada";
  }
  if (estado === "cortando") {
    return "Cortando…";
  }
  if (estado === "sonando") {
    return "Timbrando…";
  }
  return "Llamando…";
}
