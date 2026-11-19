"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { guardarAsignacion, type DatosDeAsignacion } from "@/app/actions/asignacion-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ConfigDeAsignacion } from "@/lib/reparto-cuando-lo-necesita";

const INTERRUPTORES: Array<{ clave: keyof ConfigDeAsignacion; titulo: string; detalle: string }> = [
  {
    clave: "agentePide",
    titulo: "El agente pide asesora o pausa la IA",
    detalle: "Se asigna siempre, haya mandado fotos o no.",
  },
  {
    clave: "clientaPreguntaPlataOEntrega",
    titulo: "La clienta pregunta precio, pago, envío o contraentrega, o dice su ciudad",
    detalle: "Solo después de que el bot mandó las fotos.",
  },
  {
    clave: "asesoraEscribe",
    titulo: "Una asesora escribe en el chat",
    detalle: "Si el chat no tiene asesora, se le queda a la que escribe.",
  },
  {
    clave: "comoAntes",
    titulo: "Como antes (al responder la bienvenida)",
    detalle: "Prendido, se asigna apenas la clienta responde la bienvenida y no se miran los otros tres.",
  },
];

/**
 * Formulario de Equipo > Asignación: los cuatro interruptores, quién está en el reparto de cada línea
 * de ventas y los minutos de la regla de demora. Un solo botón Guardar.
 */
export function AsignacionForm({ datos }: { datos: DatosDeAsignacion }) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [interruptores, setInterruptores] = useState<ConfigDeAsignacion>(datos.interruptores);
  const [fuera, setFuera] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      datos.lineas.map((linea) => [linea.id, linea.asesoras.filter((a) => !a.enElReparto).map((a) => a.id)]),
    ),
  );
  const [aviso, setAviso] = useState(String(datos.minutosAviso));
  const [reasignar, setReasignar] = useState(String(datos.minutosReasignar));
  const [error, setError] = useState("");

  function cambiarReparto(lineaId: string, asesoraId: string) {
    setFuera((actual) => {
      const lista = actual[lineaId] ?? [];
      return {
        ...actual,
        [lineaId]: lista.includes(asesoraId) ? lista.filter((id) => id !== asesoraId) : [...lista, asesoraId],
      };
    });
  }

  function guardar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError("");
    empezar(async () => {
      let resultado: Awaited<ReturnType<typeof guardarAsignacion>>;
      try {
        resultado = await guardarAsignacion({
          interruptores,
          lineas: datos.lineas.filter((linea) => !linea.abierta).map((linea) => ({ id: linea.id, fuera: fuera[linea.id] ?? [] })),
          minutosAviso: aviso,
          minutosReasignar: reasignar,
        });
      } catch {
        setError("No se pudo guardar. Intenta de nuevo.");
        return;
      }
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      toast.success("Asignación guardada");
      router.refresh();
    });
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Cuándo se asigna un chat</CardTitle>
          <CardDescription>El chat se le asigna a una asesora cuando pasa algo de lo que esté prendido.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {INTERRUPTORES.map(({ clave, titulo, detalle }) => {
            const apagadoPorComoAntes = clave !== "comoAntes" && interruptores.comoAntes;
            return (
              <div key={clave} className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <Label htmlFor={`asignacion-${clave}`} className="text-sm leading-snug">
                    {titulo}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {apagadoPorComoAntes ? "No se mira mientras «Como antes» esté prendido." : detalle}
                  </p>
                </div>
                <Switch
                  id={`asignacion-${clave}`}
                  checked={interruptores[clave]}
                  onCheckedChange={(valor) => setInterruptores((actual) => ({ ...actual, [clave]: valor }))}
                  aria-label={titulo}
                  className="mt-0.5"
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Quién está en el reparto</CardTitle>
          <CardDescription>
            Fuera del reparto no le llegan chats nuevos, pero sigue en la línea y atiende los suyos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {datos.lineas.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay líneas de ventas. Conecta una en Conexión.</p>
          ) : (
            datos.lineas.map((linea) => {
              const listaFuera = fuera[linea.id] ?? [];
              const enElReparto = linea.asesoras.filter((a) => !listaFuera.includes(a.id)).length;
              return (
                <div key={linea.id} className="space-y-2">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="break-words">{linea.nombre}</span>
                    {!linea.abierta ? (
                      <Badge variant="secondary">
                        {enElReparto} de {linea.asesoras.length} en el reparto
                      </Badge>
                    ) : null}
                  </p>
                  {linea.abierta ? (
                    <p className="text-xs text-muted-foreground">
                      Esta línea no tiene asesoras fijas: la ve todo el equipo. Su reparto se arma en Conexión.
                    </p>
                  ) : (
                    <>
                      <ul className="space-y-1.5">
                        {linea.asesoras.map((asesora) => {
                          const estaFuera = listaFuera.includes(asesora.id);
                          return (
                            <li key={asesora.id} className="flex items-center justify-between gap-3">
                              <span className="min-w-0 truncate text-sm">{asesora.nombre}</span>
                              <Button
                                type="button"
                                size="sm"
                                variant={estaFuera ? "outline" : "default"}
                                aria-pressed={!estaFuera}
                                aria-label={`${asesora.nombre} en ${linea.nombre}: ${estaFuera ? "fuera del reparto" : "en el reparto"}`}
                                onClick={() => cambiarReparto(linea.id, asesora.id)}
                                className="shrink-0"
                              >
                                {estaFuera ? "Fuera" : "En el reparto"}
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                      {enElReparto === 0 ? (
                        <p className="text-xs text-destructive">
                          Nadie está en el reparto: los chats nuevos de esta línea entran sin asesora.
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
            Demora de la asesora
            <Badge variant={datos.demoraPrendida ? "default" : "secondary"}>
              {datos.demoraPrendida ? "Prendida" : "Apagada"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Si la asesora no responde, se le avisa y después el chat pasa a otra. Se prende o se apaga en Equipo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="asignacion-minutos-aviso">Avisar a los (min)</Label>
              <Input
                id="asignacion-minutos-aviso"
                type="number"
                inputMode="numeric"
                min={1}
                max={120}
                step={1}
                value={aviso}
                onChange={(evento) => setAviso(evento.target.value)}
                className="w-24"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="asignacion-minutos-reasignar">Pasar a otra a los (min)</Label>
              <Input
                id="asignacion-minutos-reasignar"
                type="number"
                inputMode="numeric"
                min={2}
                max={120}
                step={1}
                value={reasignar}
                onChange={(evento) => setReasignar(evento.target.value)}
                className="w-24"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar"}
        </Button>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
