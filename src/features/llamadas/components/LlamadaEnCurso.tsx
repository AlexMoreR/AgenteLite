"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { toast } from "sonner";

import { looksLikeLidNumber } from "@/lib/whatsapp-lid";

import { PanelDeLlamada } from "./PanelDeLlamada";
import { useLlamada, type EstadoLlamada } from "./useLlamada";

/**
 * La llamada en curso de todo el CRM: una sola, montada una sola vez (en providers.tsx).
 *
 * Antes cada boton de llamar tenia su propia llamada, su panel y su audio, adentro de la cabecera
 * del chat abierto. Al abrir otro chat o ir a otra pantalla la cabecera se desmontaba y con ella la
 * llamada: de este lado se cortaba el audio, y del otro al cliente le seguia timbrando o quedaba en
 * una llamada muda. Ahora la llamada vive aca arriba y los botones solo marcan.
 */

type DatosDeLaLlamada = {
  telefono: string;
  nombre: string;
  avatarUrl?: string | null;
};

export type Marcar = (datos: DatosDeLaLlamada & { channelId?: string | null }) => void;

type ValorLlamadaEnCurso = {
  estado: EstadoLlamada;
  /** Ya hay una llamada (marcando, sonando, hablando o mostrando como termino). */
  ocupada: boolean;
  marcar: Marcar;
};

const LlamadaEnCursoContext = createContext<ValorLlamadaEnCurso | null>(null);

/** Fuera del componente para que no cambie en cada render (el reloj lo redibuja cada segundo). */
const avisarError = (mensaje: string) => {
  toast.error(mensaje);
};

export function LlamadaEnCursoProvider({ children }: { children: React.ReactNode }) {
  // La UNICA llamada del CRM: este es el unico lugar que usa el hook.
  const { estado, silenciado, segundos, motivoFin, recienContesto, llamar, colgar, alternarSilencio, audioRef } = useLlamada({
    onError: avisarError,
  });

  /** A quien se esta llamando: el panel lo sigue mostrando aunque se cambie de chat. */
  const [datos, setDatos] = useState<DatosDeLaLlamada | null>(null);

  // Cada llamada arranca en pantalla completa; minimizar es una decision de la asesora DENTRO de
  // esa llamada, no una preferencia que deba sobrevivir a la siguiente. Se decide al marcar y no
  // reaccionando al estado despues, que era una vuelta de mas.
  const [expandido, setExpandido] = useState(true);

  const ocupada = estado !== "libre";

  const marcar = useCallback<Marcar>(
    ({ telefono, nombre, avatarUrl, channelId }) => {
      if (ocupada) {
        return;
      }
      setDatos({ telefono, nombre, avatarUrl });
      setExpandido(true);
      /*
        Los leads de anuncios llegan con un identificador oculto en vez de telefono, y a ese
        identificador SI se le puede llamar: probado el 25-09-2026 llamando al numero de Alex por
        su identificador -timbro, contesto, y el audio se establecio-.
      */
      void llamar(telefono, channelId, looksLikeLidNumber(telefono));
    },
    [ocupada, llamar],
  );

  const valor = useMemo<ValorLlamadaEnCurso>(() => ({ estado, ocupada, marcar }), [estado, ocupada, marcar]);

  return (
    <LlamadaEnCursoContext.Provider value={valor}>
      {children}

      {estado !== "libre" && datos ? (
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
          onMinimizar={() => setExpandido(false)}
          onExpandir={() => setExpandido(true)}
          onColgar={() => void colgar()}
          onAlternarSilencio={() => void alternarSilencio()}
        />
      ) : null}

      {/* El audio del cliente. Sin controles y fuera de la vista: la barra flotante ya tiene los
          botones, y un reproductor suelto ahi invita a pausar la llamada, que no es una idea.
          Siempre montado: la llamada le pone el sonido apenas conecta. */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
    </LlamadaEnCursoContext.Provider>
  );
}

/** La llamada en curso. Fuera del proveedor no hay con que llamar: el boton sale apagado. */
export function useLlamadaEnCurso(): ValorLlamadaEnCurso | null {
  return useContext(LlamadaEnCursoContext);
}
