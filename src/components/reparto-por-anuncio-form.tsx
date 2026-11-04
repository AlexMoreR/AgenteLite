"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  borrarReglaDeAnuncioAction,
  cambiarReglaDeAnuncioAction,
  crearReglaDeAnuncioAction,
} from "@/app/actions/reparto-por-anuncio-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";

export type ReglaParaPantalla = {
  id: string;
  tipo: "campana" | "anuncio";
  metaId: string;
  nombre: string;
  channelId: string;
  asignarA: string | null;
  sinBienvenida: boolean;
  activa: boolean;
};

type Opcion = { id: string; nombre: string };

const ID_DE_META = /^\d{5,25}$/;

export function RepartoPorAnuncioForm({
  reglas,
  lineas,
  asesoras,
  nombres,
}: {
  reglas: ReglaParaPantalla[];
  lineas: Opcion[];
  /** Quienes se pueden elegir: activas en el equipo. */
  asesoras: Opcion[];
  /** El nombre de cada persona de las reglas, aunque ya no esté activa. */
  nombres: Record<string, string>;
}) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [tipo, setTipo] = useState<"campana" | "anuncio">("campana");
  const [metaId, setMetaId] = useState("");
  const [nombre, setNombre] = useState("");
  const [channelId, setChannelId] = useState(lineas[0]?.id ?? "");
  const [asignarA, setAsignarA] = useState(asesoras[0]?.id ?? "");
  const [sinBienvenida, setSinBienvenida] = useState(true);
  const [error, setError] = useState("");

  const nombreDe = (lista: Opcion[], id: string | null) => lista.find((item) => item.id === id)?.nombre ?? "—";

  function crear(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const id = metaId.trim();
    if (!ID_DE_META.test(id)) {
      setError("El número de Meta tiene que ser solo números, de 5 a 25 cifras.");
      return;
    }
    setError("");
    empezar(async () => {
      const resultado = await crearReglaDeAnuncioAction({ tipo, metaId: id, nombre, channelId, asignarA, sinBienvenida });
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      toast.success("Regla guardada");
      setMetaId("");
      setNombre("");
      router.refresh();
    });
  }

  function cambiar(id: string, activa: boolean) {
    empezar(async () => {
      const resultado = await cambiarReglaDeAnuncioAction({ id, activa });
      if ("error" in resultado) {
        toast.error(resultado.error);
        return;
      }
      toast.success(activa ? "Regla prendida" : "Regla apagada");
      router.refresh();
    });
  }

  function borrar(regla: ReglaParaPantalla) {
    if (!window.confirm(`¿Borrar la regla «${regla.nombre}»?`)) return;
    empezar(async () => {
      const resultado = await borrarReglaDeAnuncioAction({ id: regla.id });
      if ("error" in resultado) {
        toast.error(resultado.error);
        return;
      }
      toast.success("Regla borrada");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Nueva regla</CardTitle>
        </CardHeader>
        <CardContent>
          {lineas.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay líneas de WhatsApp. Conecta una en Conexión primero.</p>
          ) : (
            <form onSubmit={crear} className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="regla-tipo">Tipo</Label>
                <NativeSelect
                  id="regla-tipo"
                  className="w-full"
                  value={tipo}
                  onChange={(evento) => setTipo(evento.target.value === "anuncio" ? "anuncio" : "campana")}
                >
                  <NativeSelectOption value="campana">Campaña</NativeSelectOption>
                  <NativeSelectOption value="anuncio">Anuncio</NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="regla-id">Número de {tipo === "anuncio" ? "anuncio" : "campaña"} en Meta</Label>
                <Input
                  id="regla-id"
                  inputMode="numeric"
                  placeholder="Ej. 120210000000000000"
                  value={metaId}
                  onChange={(evento) => setMetaId(evento.target.value)}
                  aria-invalid={error !== "" && !ID_DE_META.test(metaId.trim())}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="regla-nombre">Nombre para reconocerla</Label>
                <Input
                  id="regla-nombre"
                  placeholder="Ej. Salones y almacenes"
                  maxLength={80}
                  value={nombre}
                  onChange={(evento) => setNombre(evento.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="regla-linea">Línea</Label>
                <NativeSelect
                  id="regla-linea"
                  className="w-full"
                  value={channelId}
                  onChange={(evento) => setChannelId(evento.target.value)}
                >
                  {lineas.map((linea) => (
                    <NativeSelectOption key={linea.id} value={linea.id}>
                      {linea.nombre}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="regla-asesora">A quién va</Label>
                <NativeSelect
                  id="regla-asesora"
                  className="w-full"
                  value={asignarA}
                  onChange={(evento) => setAsignarA(evento.target.value)}
                >
                  {asesoras.map((asesora) => (
                    <NativeSelectOption key={asesora.id} value={asesora.id}>
                      {asesora.nombre}
                    </NativeSelectOption>
                  ))}
                  <NativeSelectOption value="">Reparto normal</NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="flex items-center gap-2 sm:pt-6">
                <Checkbox
                  id="regla-sin-bienvenida"
                  checked={asignarA !== "" && sinBienvenida}
                  disabled={asignarA === ""}
                  onCheckedChange={(valor) => setSinBienvenida(valor === true)}
                />
                <Label htmlFor="regla-sin-bienvenida" className="font-normal">
                  Sin bienvenida del bot (contesta la asesora)
                </Label>
              </div>
              {error ? (
                <p className="text-sm text-destructive sm:col-span-2" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="sm:col-span-2">
                <Button type="submit" disabled={pendiente}>
                  {pendiente ? "Guardando…" : "Guardar regla"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Reglas guardadas</CardTitle>
        </CardHeader>
        <CardContent>
          {reglas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavía no hay reglas. Mientras no haya ninguna, todos los chats siguen el reparto normal.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {reglas.map((regla) => (
                <li key={regla.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{regla.nombre}</span>
                      <Badge variant="outline">{regla.tipo === "anuncio" ? "Anuncio" : "Campaña"}</Badge>
                      {regla.sinBienvenida ? <Badge variant="secondary">Sin bienvenida</Badge> : null}
                      {!regla.activa ? <Badge variant="secondary">Apagada</Badge> : null}
                    </div>
                    <p className="break-all text-xs text-muted-foreground">
                      {regla.metaId} · {nombreDe(lineas, regla.channelId)} →{" "}
                      {regla.asignarA
                        ? asesoras.some((asesora) => asesora.id === regla.asignarA)
                          ? nombreDe(asesoras, regla.asignarA)
                          : `${nombres[regla.asignarA] ?? "Persona"} (no está activa: va al reparto normal)`
                        : "Reparto normal"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={regla.activa}
                      disabled={pendiente}
                      onCheckedChange={(valor) => cambiar(regla.id, valor === true)}
                      aria-label={regla.activa ? "Apagar la regla" : "Prender la regla"}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={pendiente}
                      onClick={() => borrar(regla)}
                      aria-label="Borrar la regla"
                      title="Borrar"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
