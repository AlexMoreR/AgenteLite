"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  crearClaveMcpAction,
  deshacerCambioMcpAction,
  revocarClaveMcpAction,
} from "@/app/actions/mcp-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ClaveListada = { id: string; nombre: string; creadaEl: string; ultimoUso: string | null };

type CambioListado = { id: string; at: string; titulo: string; accion: string; deshecho: boolean };

const FECHA = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

function BotonCopiar({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(texto).then(() => {
          setCopiado(true);
          window.setTimeout(() => setCopiado(false), 1500);
        });
      }}
    >
      {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copiado ? "Copiado" : etiqueta}
    </Button>
  );
}

/**
 * Conectar Claude al CRM.
 *
 * La clave se ve UNA sola vez, al crearla: el servidor guarda solo su huella. Si se pierde, se
 * revoca y se crea otra.
 */
export function ConexionClaudeWorkspace({
  direccion,
  negocio,
  claves,
  cambios,
}: {
  direccion: string;
  negocio: string;
  claves: ClaveListada[];
  cambios: CambioListado[];
}) {
  const [nombre, setNombre] = useState("Claude de Alex");
  const [claveNueva, setClaveNueva] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const comando = claveNueva
    ? `claude mcp add --transport http aizenbot ${direccion} --header "Authorization: Bearer ${claveNueva}"`
    : "";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-5">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Conectar Claude</h1>
        <p className="text-sm text-muted-foreground">
          Claude podrá leer las conversaciones, el agente y los productos de <b>{negocio}</b> para encontrar
          dónde el agente dio información equivocada. Solo lee: no envía mensajes ni cambia nada.
        </p>
      </div>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Crear una clave</h2>
        <div className="flex flex-wrap gap-2">
          <Input
            value={nombre}
            onChange={(evento) => setNombre(evento.target.value)}
            maxLength={60}
            placeholder="Para qué es (ej. Claude de Alex)"
            className="min-w-0 flex-1 text-[16px] md:text-sm"
          />
          <Button
            type="button"
            disabled={pendiente}
            onClick={() =>
              startTransition(async () => {
                const resultado = await crearClaveMcpAction(nombre);
                if ("error" in resultado) {
                  toast.error(resultado.error);
                  return;
                }
                setClaveNueva(resultado.clave);
              })
            }
          >
            <KeyRound className="size-4" />
            {pendiente ? "Creando…" : "Crear clave"}
          </Button>
        </div>

        {claveNueva ? (
          <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
            <p className="text-[13px] font-medium text-amber-900 dark:text-amber-100">
              Copiala ahora: no se vuelve a mostrar. No la pegues en chats ni la compartas.
            </p>
            <div className="flex flex-wrap gap-2">
              <BotonCopiar texto={claveNueva} etiqueta="Copiar clave" />
              <BotonCopiar texto={comando} etiqueta="Copiar comando para Claude Code" />
            </div>
            <p className="text-[12px] text-amber-900/80 dark:text-amber-100/80">
              En Claude Code: pegá el comando en una terminal y listo. Después preguntale a Claude, por ejemplo,
              “revisá los chats de ayer de Ventas 1 y decime dónde el agente dio información equivocada”.
            </p>
          </div>
        ) : null}

        <div className="space-y-1 text-[12px] text-muted-foreground">
          <p>
            Dirección del servidor: <code className="rounded bg-muted px-1 py-0.5">{direccion}</code>
          </p>
          <p>Cabecera: Authorization: Bearer (la clave)</p>
        </div>
      </section>

      <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Claves activas</h2>
        {claves.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay ninguna.</p>
        ) : (
          <ul className="divide-y divide-border">
            {claves.map((clave) => (
              <li key={clave.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{clave.nombre}</p>
                  <p className="text-[12px] text-muted-foreground">
                    Creada {FECHA.format(new Date(clave.creadaEl))}
                    {" · "}
                    {clave.ultimoUso ? `usada ${FECHA.format(new Date(clave.ultimoUso))}` : "sin usar"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pendiente}
                  className="text-rose-600"
                  onClick={() => {
                    if (!window.confirm(`¿Revocar "${clave.nombre}"? Claude deja de poder leer con esa clave.`)) {
                      return;
                    }
                    startTransition(async () => {
                      const resultado = await revocarClaveMcpAction(clave.id);
                      if ("error" in resultado) {
                        toast.error(resultado.error);
                        return;
                      }
                      toast.success("Clave revocada");
                    });
                  }}
                >
                  <Trash2 className="size-4" />
                  Revocar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        Lo que Claude cambio, y como volver atras.

        Es la condicion con la que esto escribe: aplica directo, pero cualquier cambio se deshace
        en un clic, sin depender de tener Claude abierto (Alex, 18-sep-2026).
      */}
      <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Cambios hechos desde Claude</h2>
        {cambios.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no cambió nada. Cuando le pidas a Claude que corrija un guion, un texto del agente
            o un seguimiento, va a quedar acá para revisarlo o deshacerlo.
          </p>
        ) : (
          <ul className="space-y-2">
            {cambios.map((cambio) => (
              <li
                key={cambio.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{cambio.titulo}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {FECHA.format(new Date(cambio.at))} · {cambio.accion}
                    {cambio.deshecho ? " · deshecho" : ""}
                  </p>
                </div>
                {cambio.deshecho ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pendiente}
                    onClick={() => {
                      startTransition(async () => {
                        const resultado = await deshacerCambioMcpAction(cambio.id);
                        if (resultado?.error) {
                          toast.error(resultado.error);
                          return;
                        }
                        toast.success("Listo, quedó como estaba");
                      });
                    }}
                  >
                    <RotateCcw className="size-4" />
                    Deshacer
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
