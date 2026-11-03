"use client";

import { useEffect, useState } from "react";
import { Loader2, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SalaDeReunion, type PaseDeLaSala, type ResultadoDelPase } from "@/features/reuniones/components/SalaDeReunion";

const CLAVE_IDENTIDAD = "reunion:identidad";
const CLAVE_NOMBRE = "reunion:nombre";

/** Lo que el navegador recuerda del invitado: si se cae y vuelve, entra como la misma persona. */
function recordado(clave: string) {
  try {
    return window.localStorage.getItem(clave) ?? "";
  } catch {
    return "";
  }
}

function recordar(clave: string, valor: string) {
  try {
    window.localStorage.setItem(clave, valor);
  } catch {
    // Navegación privada: no se recuerda, y no pasa nada.
  }
}

/**
 * La puerta de la reunión: el nombre (si no hay sesión), el aviso de grabación y "Entrar".
 * Al entrar pide el pase al servidor del CRM y abre la sala.
 */
export function EntradaALaReunion({ codigo, titulo, sinGrabar = false, nombreConSesion }: { codigo: string; titulo: string; sinGrabar?: boolean; nombreConSesion: string | null }) {
  const [nombre, setNombre] = useState("");
  const [entrando, setEntrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pase, setPase] = useState<PaseDeLaSala | null>(null);

  // El nombre que usó la vez pasada (después de pintar, para no chocar con lo que pintó el servidor).
  useEffect(() => {
    const anterior = recordado(CLAVE_NOMBRE);
    if (anterior) {
      setNombre((actual) => actual || anterior);
    }
  }, []);

  /**
   * Pide el pase al servidor del CRM, con la misma identidad (la sesión o la que guarda el navegador).
   * La usa «Entrar» y también la sala para volver a entrar sola si se cae la conexión.
   */
  const pedirPase = async (): Promise<ResultadoDelPase> => {
    try {
      const respuesta = await fetch("/api/reuniones/pase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo, nombre: nombre.trim(), identidad: recordado(CLAVE_IDENTIDAD) }),
        cache: "no-store",
      });
      const datos = (await respuesta.json().catch(() => ({}))) as Partial<PaseDeLaSala> & {
        ok?: boolean;
        error?: string;
        recuerdo?: string | null;
      };
      if (!respuesta.ok || !datos.ok || !datos.pase || !datos.url) {
        // 410: la reunión ya terminó (no tiene sentido seguir intentando).
        return { error: datos.error ?? "No se pudo entrar. Intenta de nuevo.", terminada: respuesta.status === 410 };
      }
      if (!nombreConSesion && datos.recuerdo) {
        recordar(CLAVE_IDENTIDAD, datos.recuerdo);
        recordar(CLAVE_NOMBRE, nombre.trim());
      }
      return {
        pase: { url: datos.url, pase: datos.pase, identidad: datos.identidad ?? "", nombre: datos.nombre ?? nombre, puedeTerminar: Boolean(datos.puedeTerminar) },
      };
    } catch {
      return { error: "No hay conexión. Intenta de nuevo.", terminada: false };
    }
  };

  const entrar = async (evento?: React.FormEvent) => {
    evento?.preventDefault();
    if (!nombreConSesion && nombre.trim().length < 2) {
      setError("Escribe tu nombre para entrar.");
      return;
    }
    setEntrando(true);
    setError(null);
    const resultado = await pedirPase();
    setEntrando(false);
    if ("pase" in resultado) {
      setPase(resultado.pase);
    } else {
      setError(resultado.error);
    }
  };

  if (pase) {
    return <SalaDeReunion codigo={codigo} titulo={titulo} sinGrabar={sinGrabar} pase={pase} pedirPase={pedirPase} onSalir={() => setPase(null)} />;
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-8">
      <form onSubmit={entrar} className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card px-5 py-6">
        <div className="space-y-1 text-center">
          <Video className="mx-auto size-7 text-primary" />
          <h1 className="text-lg font-semibold">{titulo}</h1>
        </div>

        {nombreConSesion ? (
          <p className="text-center text-sm text-muted-foreground">
            Entras como <span className="font-medium text-foreground">{nombreConSesion}</span>
          </p>
        ) : (
          <Input
            value={nombre}
            onChange={(evento) => setNombre(evento.target.value)}
            placeholder="Tu nombre"
            maxLength={60}
            autoComplete="name"
            autoFocus
          />
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button type="submit" size="lg" className="w-full" disabled={entrando}>
          {entrando ? <Loader2 className="animate-spin" /> : null}
          Entrar a la reunión
        </Button>
        <p className="text-center text-xs text-muted-foreground">Al entrar, el navegador te pedirá permiso para usar el micrófono.</p>
      </form>
    </div>
  );
}
