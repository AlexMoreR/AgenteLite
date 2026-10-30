"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Loader2, MessageCircle, Pencil, Plus, Users, Video } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { crearSalaAction, editarSalaAction } from "@/app/actions/reuniones-actions";

/*
  SALAS FIJAS (como un canal de Teams): cada área tiene su sala con un link que no cambia
  (/reunion/sala/<codigo>). Aquí se ven todas, con su líder, si hay una «En vivo», la última
  reunión y cuántas lleva. «Nueva sala» y «Editar» solo los ve el dueño o un administrador
  (el servidor igual lo revisa).
*/

export type SalaDeLaPantalla = {
  id: string;
  nombre: string;
  codigo: string;
  sinGrabar: boolean;
  lider: { id: string; nombre: string } | null;
  /** Hay una reunión de la sala En vivo. */
  enVivo: boolean;
  /** Hay una reunión de la sala Esperando o En vivo (la lista se pone al día sola mientras tanto). */
  abierta: boolean;
  ultimaReunion: string | null;
  totalDeReuniones: number;
};

export type UsuarioDelNegocio = { id: string; nombre: string };

export function linkDeLaSala(codigo: string) {
  return `${window.location.origin}/reunion/sala/${codigo}`;
}

const formatearDia = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Bogota" }).format(new Date(iso));

/** "Copiar link", "Enviar por WhatsApp" (wa.me: lo manda quien lo toca, no usa las líneas del CRM) e "Iniciar"/"Entrar". */
export function CompartirSala({ sala }: { sala: Pick<SalaDeLaPantalla, "nombre" | "codigo" | "abierta"> }) {
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(linkDeLaSala(sala.codigo));
      toast.success("Link copiado");
    } catch {
      toast.error("No se pudo copiar. Entra a la sala y copia el link de arriba.");
    }
  };
  const whatsapp = () => {
    const texto = `Te invito a la sala "${sala.nombre}". Entra desde aquí, sin instalar nada: ${linkDeLaSala(sala.codigo)}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener,noreferrer");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="outline" onClick={copiar}>
        <Copy /> Copiar link
      </Button>
      <Button size="sm" variant="outline" onClick={whatsapp}>
        <MessageCircle /> Enviar por WhatsApp
      </Button>
      <Button size="sm" render={<Link href={`/reunion/sala/${sala.codigo}`} target="_blank" />}>
        <Video /> {sala.abierta ? "Entrar" : "Iniciar"}
      </Button>
    </div>
  );
}

/** El formulario de «Nueva sala» y «Editar»: nombre, líder (opcional) y si se graba. */
function FormularioDeSala({
  sala,
  usuarios,
  alCerrar,
}: {
  /** null: sala nueva. */
  sala: SalaDeLaPantalla | null;
  usuarios: UsuarioDelNegocio[];
  alCerrar: () => void;
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState(sala?.nombre ?? "");
  const [liderId, setLiderId] = useState(sala?.lider?.id ?? "");
  const [grabar, setGrabar] = useState(!(sala?.sinGrabar ?? false));
  const [guardando, startGuardar] = useTransition();
  // Si el líder ya no está en la lista (se fue del equipo), igual se muestra para no borrarlo sin querer.
  const opciones = sala?.lider && !usuarios.some((usuario) => usuario.id === sala.lider?.id) ? [sala.lider, ...usuarios] : usuarios;

  const guardar = (evento: React.FormEvent) => {
    evento.preventDefault();
    if (!nombre.trim()) {
      toast.error("Escribe el nombre de la sala.");
      return;
    }
    startGuardar(async () => {
      const datos = { nombre, liderId: liderId || null, sinGrabar: !grabar };
      const resultado = sala ? await editarSalaAction(sala.id, datos) : await crearSalaAction(datos);
      if (resultado.error) {
        toast.error(resultado.error);
        return;
      }
      toast.success(sala ? "Sala guardada" : "Sala creada");
      alCerrar();
      router.refresh();
    });
  };

  return (
    <form onSubmit={guardar} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="sala-nombre">Nombre</Label>
        <Input
          id="sala-nombre"
          value={nombre}
          onChange={(evento) => setNombre(evento.target.value)}
          placeholder="Ej.: Sistemas - Emanuel"
          maxLength={120}
          autoFocus
        />
        {sala ? (
          <p className="text-xs text-muted-foreground">El link no cambia al renombrarla: /reunion/sala/{sala.codigo}</p>
        ) : (
          <p className="text-xs text-muted-foreground">El link sale del nombre y después no cambia.</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sala-lider">Líder (opcional)</Label>
        <NativeSelect id="sala-lider" className="w-full" value={liderId} onChange={(evento) => setLiderId(evento.target.value)}>
          <NativeSelectOption value="">Sin líder</NativeSelectOption>
          {opciones.map((usuario) => (
            <NativeSelectOption key={usuario.id} value={usuario.id}>
              {usuario.nombre}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">El líder puede terminar las reuniones de esta sala.</p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={grabar} onChange={(evento) => setGrabar(evento.target.checked)} className="mt-0.5 size-4" />
        <span>
          Grabar las reuniones
          <span className="block text-xs text-muted-foreground">Si no se graban, no hay transcripción ni acta.</span>
        </span>
      </label>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={alCerrar} disabled={guardando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={guardando}>
          {guardando ? <Loader2 className="animate-spin" /> : null}
          {sala ? "Guardar" : "Crear sala"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** «Editar» una sala con el mismo formulario de la lista (en la pantalla de la sala). Solo dueño o admin. */
export function BotonEditarSala({ sala, usuarios }: { sala: SalaDeLaPantalla; usuarios: UsuarioDelNegocio[] }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setAbierto(true)}>
        <Pencil /> Editar
      </Button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar sala</DialogTitle>
            <DialogDescription>Una sala por área, con un link fijo para todas sus reuniones.</DialogDescription>
          </DialogHeader>
          {abierto ? <FormularioDeSala sala={sala} usuarios={usuarios} alCerrar={() => setAbierto(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SalasDeReuniones({
  salas,
  usuarios,
  puedeAdministrar,
}: {
  /** null: no se pudieron leer. */
  salas: SalaDeLaPantalla[] | null;
  usuarios: UsuarioDelNegocio[];
  puedeAdministrar: boolean;
}) {
  // undefined: cerrado; null: sala nueva; una sala: editarla.
  const [editando, setEditando] = useState<SalaDeLaPantalla | null | undefined>(undefined);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Salas</h2>
        {puedeAdministrar ? (
          <Button size="sm" onClick={() => setEditando(null)}>
            <Plus /> Nueva sala
          </Button>
        ) : null}
      </div>

      {salas === null ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No se pudieron cargar las salas. Recarga la página.
        </p>
      ) : salas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
          <Users className="mx-auto mb-2 size-5 text-muted-foreground" />
          <p className="text-sm font-medium">Todavía no hay salas</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            {puedeAdministrar
              ? "Crea una sala por área: tiene un link que no cambia y guarda todas sus reuniones."
              : "El dueño o un administrador puede crear una sala por área, con un link que no cambia."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {salas.map((sala) => (
            <div key={sala.id} className="space-y-2 rounded-xl border border-border bg-card px-3 py-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link href={`/cliente/reuniones/sala/${sala.id}`} className="min-w-0 truncate text-sm font-semibold text-foreground hover:underline">{sala.nombre}</Link>
                    {sala.enVivo ? <Badge variant="destructive">● En vivo</Badge> : null}
                    {sala.sinGrabar ? <Badge variant="outline">Sin grabar</Badge> : null}
                  </div>
                  <span className="block text-xs text-muted-foreground">
                    {sala.lider ? `Líder: ${sala.lider.nombre}` : "Sin líder"}
                    {" · "}
                    {sala.totalDeReuniones === 0
                      ? "Sin reuniones todavía"
                      : `${sala.totalDeReuniones} ${sala.totalDeReuniones === 1 ? "reunión" : "reuniones"}`}
                    {sala.ultimaReunion ? ` · Última: ${formatearDia(sala.ultimaReunion)}` : ""}
                  </span>
                </div>
                {puedeAdministrar ? (
                  <Button size="sm" variant="ghost" onClick={() => setEditando(sala)} aria-label={`Editar ${sala.nombre}`}>
                    <Pencil /> Editar
                  </Button>
                ) : null}
              </div>
              <CompartirSala sala={sala} />
            </div>
          ))}
        </div>
      )}

      {puedeAdministrar ? (
        <Dialog open={editando !== undefined} onOpenChange={(abierto) => (abierto ? null : setEditando(undefined))}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editando ? "Editar sala" : "Nueva sala"}</DialogTitle>
              <DialogDescription>Una sala por área, con un link fijo para todas sus reuniones.</DialogDescription>
            </DialogHeader>
            {editando !== undefined ? (
              <FormularioDeSala key={editando?.id ?? "nueva"} sala={editando} usuarios={usuarios} alCerrar={() => setEditando(undefined)} />
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
