"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Phone, PhoneOff } from "lucide-react";
import { toast } from "sonner";

import { ContactAvatar } from "@/components/chats/contact-avatar";

import {
  clienteDeLaLlamada,
  EVENTO_LLAMADA_ENTRANTE,
  leerAvisoDeLlamadaEntrante,
  type AvisoDeLlamadaEntrante,
} from "./aviso-de-llamada-entrante";
import { useLlamadaEnCurso } from "./LlamadaEnCurso";
import {
  empezarTonoDeLlamadaEntrante,
  empezarVibracionDeLlamadaEntrante,
  prepararAudioDeTimbre,
} from "./sonidos-de-llamada";

/**
 * La pantalla de llamada ENTRANTE (parte 3 de "Llamadas entrantes en la PWA", 21-nov-2026).
 *
 * Con el CRM abierto, cuando un cliente llama a una línea del negocio, sale encima de todo con la
 * foto, el nombre y el número, timbra en bucle y, en Android, vibra. Deja de timbrar al contestar,
 * al colgar o cuando el servidor avisa que la contestaron (otra asesora: a las demás se les apaga)
 * o que terminó.
 *
 * También se abre desde la notificación del celular: esa trae `?llamada=<id>` y, si la llamada
 * sigue sonando, sale la pantalla; si ya terminó, lo dice.
 *
 * Vive montada una sola vez dentro de LlamadaEnCursoProvider: al contestar, la llamada pasa al
 * cuadro de siempre (PanelDeLlamada) con el mismo audio de las salientes.
 */

/** Tope de timbre si nunca llega el aviso de fin (se cayó el altavoz): WhatsApp corta antes. */
const TOPE_DE_TIMBRE_MS = 90_000;

type Pantalla =
  | { tipo: "sonando"; aviso: AvisoDeLlamadaEntrante }
  | { tipo: "terminada" };

/*
  Si WaCalls no deja contestar desde el CRM, se recuerda mientras la pestaña siga abierta: las
  siguientes llamadas ya no piden el micrófono para nada y el botón dice lo que hay que hacer.
*/
let contestarNoDisponible = false;

function enviarAccion(body: Record<string, unknown>) {
  return fetch("/api/wacalls/llamada", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
}

export function LlamadaEntrante() {
  const { ocupada, contestarEntrante } = useLlamadaEnCurso();
  const pathname = usePathname();
  const [pantalla, setPantalla] = useState<Pantalla | null>(null);
  const [contestando, setContestando] = useState(false);
  const [desdeElCelular, setDesdeElCelular] = useState(contestarNoDisponible);

  // Leídos desde los avisos, que no ven el estado de React actualizado.
  const ocupadaRef = useRef(ocupada);
  const pantallaRef = useRef<Pantalla | null>(null);
  const apagarTimbreRef = useRef<(() => void) | null>(null);
  /** Los `?llamada=<id>` que ya se miraron, para no preguntar dos veces por el mismo. */
  const enlacesMiradosRef = useRef(new Set<string>());

  useEffect(() => {
    ocupadaRef.current = ocupada;
  }, [ocupada]);
  useEffect(() => {
    pantallaRef.current = pantalla;
  }, [pantalla]);

  // El audio del timbre se deja listo con el primer toque en la pantalla (iPhone).
  useEffect(() => {
    prepararAudioDeTimbre();
  }, []);

  const apagarTimbre = useCallback(() => {
    apagarTimbreRef.current?.();
    apagarTimbreRef.current = null;
  }, []);

  /** Muestra una llamada que suena, salvo que la asesora ya esté en otra o ya se esté mostrando otra. */
  const mostrarSonando = useCallback((aviso: AvisoDeLlamadaEntrante) => {
    if (ocupadaRef.current) {
      // Ya está hablando: no se le tapa la llamada en curso, solo se le avisa.
      toast.info(`Te está llamando ${clienteDeLaLlamada(aviso)}`, { id: `llamada:${aviso.llamadaId}` });
      return;
    }
    const actual = pantallaRef.current;
    if (actual?.tipo === "sonando" && actual.aviso.llamadaId !== aviso.llamadaId) {
      return;
    }
    const siguiente: Pantalla = { tipo: "sonando", aviso };
    pantallaRef.current = siguiente;
    setPantalla(siguiente);
  }, []);

  // Los avisos en vivo que reparte chats-official-realtime.tsx.
  useEffect(() => {
    const alAviso = (evento: Event) => {
      const aviso = leerAvisoDeLlamadaEntrante((evento as CustomEvent<unknown>).detail);
      if (!aviso) {
        return;
      }
      enlacesMiradosRef.current.add(aviso.llamadaId);
      if (aviso.estado === "sonando") {
        mostrarSonando(aviso);
        return;
      }
      // Contestada (por esta u otra asesora) o terminada: deja de timbrar.
      const actual = pantallaRef.current;
      if (actual?.tipo === "sonando" && actual.aviso.llamadaId === aviso.llamadaId) {
        pantallaRef.current = null;
        setPantalla(null);
      }
    };
    window.addEventListener(EVENTO_LLAMADA_ENTRANTE, alAviso);
    return () => window.removeEventListener(EVENTO_LLAMADA_ENTRANTE, alAviso);
  }, [mostrarSonando]);

  // La notificación del celular abre el chat con `?llamada=<id>`.
  useEffect(() => {
    let llamadaId: string | null = null;
    try {
      llamadaId = new URLSearchParams(window.location.search).get("llamada")?.trim() || null;
    } catch {
      llamadaId = null;
    }
    if (!llamadaId || llamadaId.length > 128 || enlacesMiradosRef.current.has(llamadaId)) {
      return;
    }
    enlacesMiradosRef.current.add(llamadaId);
    const id = llamadaId;
    let cancelado = false;
    void enviarAccion({ accion: "entrante", llamadaId: id })
      .then(async (respuesta) => {
        if (!respuesta.ok) {
          // Sin permiso de llamadas o sin línea: no hay nada que mostrar.
          return null;
        }
        return (await respuesta.json().catch(() => null)) as {
          sonando?: boolean;
          nombre?: string | null;
          numero?: string;
          foto?: string | null;
        } | null;
      })
      .then((datos) => {
        if (cancelado || !datos || ocupadaRef.current) {
          return;
        }
        if (datos.sonando) {
          const aviso = leerAvisoDeLlamadaEntrante({
            estado: "sonando",
            llamadaId: id,
            nombre: datos.nombre,
            numero: datos.numero,
            foto: datos.foto,
          });
          if (aviso) {
            mostrarSonando(aviso);
          }
          return;
        }
        // Si mientras tanto llegó otra llamada sonando, se deja esa.
        if (pantallaRef.current?.tipo !== "sonando") {
          const siguiente: Pantalla = { tipo: "terminada" };
          pantallaRef.current = siguiente;
          setPantalla(siguiente);
        }
      })
      .catch(() => {
        // Sin red: el chat igual está abierto, que es lo que pidió la notificación.
      });
    return () => {
      cancelado = true;
    };
  }, [pathname, mostrarSonando]);

  // El timbre y la vibración, mientras suena. Se apagan solos al cerrar la pantalla.
  const llamadaSonando = pantalla?.tipo === "sonando" ? pantalla.aviso.llamadaId : null;
  useEffect(() => {
    if (!llamadaSonando) {
      return;
    }
    const apagarTono = empezarTonoDeLlamadaEntrante();
    const apagarVibracion = empezarVibracionDeLlamadaEntrante();
    let apagado = false;
    const apagar = () => {
      if (apagado) {
        return;
      }
      apagado = true;
      apagarTono();
      apagarVibracion();
    };
    apagarTimbreRef.current = apagar;
    const tope = window.setTimeout(() => {
      const actual = pantallaRef.current;
      if (actual?.tipo === "sonando" && actual.aviso.llamadaId === llamadaSonando) {
        pantallaRef.current = null;
        setPantalla(null);
      }
    }, TOPE_DE_TIMBRE_MS);
    return () => {
      window.clearTimeout(tope);
      apagar();
      if (apagarTimbreRef.current === apagar) {
        apagarTimbreRef.current = null;
      }
    };
  }, [llamadaSonando]);

  const cerrar = useCallback(() => {
    apagarTimbre();
    pantallaRef.current = null;
    setPantalla(null);
  }, [apagarTimbre]);

  const alContestar = useCallback(async () => {
    const actual = pantallaRef.current;
    if (actual?.tipo !== "sonando" || contestando) {
      return;
    }
    apagarTimbre();
    if (contestarNoDisponible) {
      // WaCalls no deja contestar desde el CRM: se contesta en el celular de la línea.
      cerrar();
      return;
    }
    const { aviso } = actual;
    setContestando(true);
    const resultado = await contestarEntrante({
      llamadaId: aviso.llamadaId,
      telefono: aviso.numero ? `+${aviso.numero}` : "",
      nombre: clienteDeLaLlamada(aviso),
      avatarUrl: aviso.foto,
    });
    setContestando(false);
    switch (resultado) {
      case "contestada":
      case "error":
        // Contestada: sigue en el cuadro de siempre. Error: ya salió el aviso con el motivo.
        cerrar();
        break;
      case "desde-el-celular":
        contestarNoDisponible = true;
        setDesdeElCelular(true);
        toast.info("Contesta desde el celular de la línea.");
        cerrar();
        break;
      case "terminada":
        apagarTimbre();
        pantallaRef.current = { tipo: "terminada" };
        setPantalla({ tipo: "terminada" });
        break;
      case "ocupada":
        toast.error("Ya tienes una llamada en curso.");
        cerrar();
        break;
    }
  }, [apagarTimbre, cerrar, contestando, contestarEntrante]);

  const alColgar = useCallback(() => {
    const actual = pantallaRef.current;
    if (actual?.tipo !== "sonando" || contestando) {
      return;
    }
    // La pantalla se cierra ya; el rechazo sale de fondo (si falla, WaCalls la corta sola al rato).
    void enviarAccion({ accion: "rechazar", llamadaId: actual.aviso.llamadaId }).catch(() => {});
    cerrar();
  }, [cerrar, contestando]);

  if (!pantalla) {
    return null;
  }

  if (pantalla.tipo === "terminada") {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="La llamada ya terminó"
        className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 bg-slate-900 px-6 text-center text-white"
      >
        <span className="inline-flex size-16 items-center justify-center rounded-full bg-white/10">
          <PhoneOff className="size-7" />
        </span>
        <div className="space-y-1">
          <h2 className="text-balance text-2xl font-semibold">La llamada ya terminó</h2>
          <p className="text-sm text-white/60">Puedes devolverle la llamada desde el chat.</p>
        </div>
        <button
          type="button"
          onClick={cerrar}
          className="inline-flex h-11 min-w-32 items-center justify-center rounded-full bg-white/10 px-6 text-sm font-medium text-white transition hover:bg-white/20"
        >
          Cerrar
        </button>
      </div>
    );
  }

  const { aviso } = pantalla;
  const cliente = clienteDeLaLlamada(aviso);
  const numeroVisible = aviso.numero ? `+${aviso.numero}` : "";

  return (
    /*
      Mismo fondo oscuro fijo que la llamada en curso (PanelDeLlamada): la pantalla queda "tomada".
      Va un piso más arriba (z-70) para quedar encima del cuadro mientras se conecta al contestar.
    */
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Te está llamando ${cliente}`}
      className="fixed inset-0 z-[70] flex flex-col items-center bg-slate-900 text-white"
    >
      <div className="flex w-full items-center justify-center px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <span className="text-xs text-white/60">Llamada de WhatsApp</span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <ContactAvatar
          avatarUrl={aviso.foto}
          label={cliente}
          className="size-32 rounded-full border-2 border-white/15 bg-white/10 text-3xl text-white"
          fallbackClassName="rounded-full bg-white/10 text-white"
        />
        <div className="max-w-full space-y-1">
          <h2 className="text-balance break-words text-2xl font-semibold">{cliente}</h2>
          {numeroVisible && numeroVisible !== cliente ? (
            <p className="text-sm tabular-nums text-white/50">{numeroVisible}</p>
          ) : null}
          <p className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-3 py-1 text-sm font-medium text-amber-200">
            <span className="inline-block size-2 shrink-0 animate-pulse rounded-full bg-amber-400" aria-hidden="true" />
            {contestando ? "Conectando…" : "Te está llamando"}
          </p>
        </div>
      </div>

      <div className="flex w-full items-start justify-center gap-16 px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        <div className="flex w-24 flex-col items-center gap-2">
          <button
            type="button"
            onClick={alColgar}
            disabled={contestando}
            aria-label="Colgar"
            className="inline-flex size-16 items-center justify-center rounded-full bg-rose-600 text-white transition hover:bg-rose-700 disabled:opacity-40"
          >
            <PhoneOff className="size-7" />
          </button>
          <span className="text-xs text-white/70">Colgar</span>
        </div>

        <div className="flex w-24 flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void alContestar()}
            disabled={contestando}
            aria-label={desdeElCelular ? "Contesta desde el celular de la línea" : "Contestar"}
            className="inline-flex size-16 items-center justify-center rounded-full bg-emerald-500 text-white transition hover:bg-emerald-600 disabled:opacity-40"
          >
            <Phone className={`size-7 ${contestando ? "" : "animate-pulse"}`} />
          </button>
          <span className="text-center text-xs text-white/70">
            {desdeElCelular ? "Contesta desde el celular de la línea" : contestando ? "Conectando…" : "Contestar"}
          </span>
        </div>
      </div>
    </div>
  );
}
