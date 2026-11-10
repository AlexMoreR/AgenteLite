"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { looksLikeLidNumber } from "@/lib/whatsapp-lid";

import { PanelDeLlamada } from "./PanelDeLlamada";
import { CLAVE_DEL_CUADRO, leerPreferencia, type PreferenciaDelCuadro } from "./posicion-del-cuadro";
import { useLlamada, type EstadoLlamada } from "./useLlamada";

/**
 * La llamada en curso, UNA sola para todo el CRM.
 *
 * Antes cada botón de llamar (la cabecera del chat lo tiene dos veces, más Mi día) armaba su propia
 * llamada, con su panel y su audio. Al abrir otro chat la cabecera se desmontaba y se llevaba la
 * llamada con ella, sin avisarle a WaCalls: el cliente quedaba timbrando o en una llamada muda.
 *
 * Ahora la llamada vive acá, montada una sola vez en los providers de la app, y los botones solo
 * piden marcar. Así sigue igual aunque la asesora cambie de chat o de pantalla.
 */

type DatosDeLaLlamada = {
  /** Con qué se marcó: teléfono o identificador oculto de WhatsApp. */
  telefono: string;
  nombre: string;
  avatarUrl?: string | null;
};

export type PedidoDeLlamada = DatosDeLaLlamada & {
  /** Línea del chat: la llamada sale por SU número. */
  channelId?: string | null;
};

type ValorLlamadaEnCurso = {
  estado: EstadoLlamada;
  /** Hay una llamada (marcando, sonando, hablando o mostrando cómo terminó). */
  ocupada: boolean;
  marcar: (pedido: PedidoDeLlamada) => void;
};

const LlamadaEnCursoContext = createContext<ValorLlamadaEnCurso | null>(null);

export function LlamadaEnCursoProvider({ children }: { children: React.ReactNode }) {
  // Se desestructura en vez de guardar el objeto entero: la referencia del audio va aparte de
  // los valores que sí se leen al dibujar, y así no parece que estuvieramos mirando una
  // referencia durante el render.
  const { estado, silenciado, segundos, motivoFin, recienContesto, llamar, colgar, alternarSilencio, audioRef } = useLlamada({
    onError: (mensaje) => toast.error(mensaje),
  });

  const [datos, setDatos] = useState<DatosDeLaLlamada | null>(null);
  // Cada llamada arranca en pantalla completa; minimizar es una decision de la asesora DENTRO de
  // esa llamada, no una preferencia que deba sobrevivir a la siguiente. Se decide al marcar y no
  // reaccionando al estado despues, que era una vuelta de mas.
  const [expandido, setExpandido] = useState(true);
  // Dónde y en qué forma (tarjeta o burbuja) quedó el cuadro minimizado la última vez, en este
  // equipo. Eso sí sobrevive entre llamadas y recargas: es dónde la asesora quiere tenerlo.
  const [cuadro, setCuadro] = useState<PreferenciaDelCuadro | null>(null);

  // Se lee en el navegador después de montar: en el servidor no hay localStorage ni ventana, y
  // leerlo al dibujar haría que el HTML del servidor no coincida con el del cliente.
  useEffect(() => {
    let guardado: string | null = null;
    try {
      guardado = window.localStorage.getItem(CLAVE_DEL_CUADRO);
    } catch {
      // Sin localStorage (modo privado estricto): se usa la esquina de arriba a la derecha.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCuadro(leerPreferencia(guardado, { anchoVentana: window.innerWidth, altoVentana: window.innerHeight }));
  }, []);

  const ocupada = estado !== "libre";

  const marcar = useCallback(
    ({ telefono, nombre, avatarUrl, channelId }: PedidoDeLlamada) => {
      if (ocupada) {
        return;
      }
      setDatos({ telefono, nombre, avatarUrl });
      setExpandido(true);
      /*
        Los leads de anuncios llegan con un identificador oculto en vez de telefono, y a ese
        identificador SI se le puede llamar: probado el 25-09-2026 llamando al numero de Alex por su
        identificador -timbro, contesto, y el audio se establecio-. Son el 15% de la base.
      */
      void llamar(telefono, { esOculto: looksLikeLidNumber(telefono), channelId });
    },
    [llamar, ocupada],
  );

  const valor = useMemo(() => ({ estado, ocupada, marcar }), [estado, ocupada, marcar]);

  return (
    <LlamadaEnCursoContext.Provider value={valor}>
      {children}

      {ocupada && datos ? (
        <PanelDeLlamada
          estado={estado}
          nombre={datos.nombre}
          telefono={datos.telefono}
          avatarUrl={datos.avatarUrl}
          silenciado={silenciado}
          segundos={segundos}
          motivoFin={motivoFin}
          recienContesto={recienContesto}
          expandido={expandido}
          cuadro={cuadro}
          onCambiarCuadro={setCuadro}
          // Al minimizar sale en la forma y el lugar guardados (tarjeta o burbuja).
          onMinimizar={() => setExpandido(false)}
          onExpandir={() => setExpandido(true)}
          onColgar={() => void colgar()}
          onAlternarSilencio={() => void alternarSilencio()}
        />
      ) : null}

      {/* El audio del cliente. Sin controles y fuera de la vista: la barra flotante ya tiene los
          botones, y un reproductor suelto ahi invita a pausar la llamada, que no es una idea.
          Va siempre montado: el hook le conecta el sonido apenas se marca. */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
    </LlamadaEnCursoContext.Provider>
  );
}

/** La llamada en curso del CRM. Solo funciona debajo de LlamadaEnCursoProvider (providers.tsx). */
export function useLlamadaEnCurso(): ValorLlamadaEnCurso {
  const valor = useContext(LlamadaEnCursoContext);
  if (!valor) {
    throw new Error("useLlamadaEnCurso necesita LlamadaEnCursoProvider (src/components/providers.tsx).");
  }
  return valor;
}
