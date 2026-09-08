"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  actualizarColaboradorDelCanalAction,
  updateChannelCollaboratorsAction,
} from "@/app/actions/chats-actions";

type CollaboratorMember = {
  id: string;
  name: string | null;
  email: string;
  /** Al dueño y a los administradores no se les recortan las vistas. */
  editableModules?: boolean;
  moduleAccess?: string[];
};

type ModuleDefinition = { key: string; label: string; description?: string };

type EstadoEnElCanal = "recibe" | "pausa" | "monitorea";

const ESTADOS: Array<{ valor: EstadoEnElCanal; titulo: string; detalle: string }> = [
  {
    valor: "recibe",
    titulo: "Recibe leads",
    detalle: "Le entran leads nuevos por turno y atiende normalmente.",
  },
  {
    valor: "pausa",
    titulo: "En pausa",
    detalle: "No le entran leads nuevos, pero sigue viendo el canal y atendiendo los suyos.",
  },
  {
    valor: "monitorea",
    titulo: "Solo monitorea",
    detalle:
      "Ve todos los chats del canal para aprender cómo responde el agente. No puede escribir ni enviar nada, y los números le salen tapados.",
  },
];

function memberLabel(member: CollaboratorMember) {
  return member.name?.trim() || member.email;
}

export function ChannelCollaboratorsForm({
  channelId,
  members,
  collaboratorIds,
  pausedAssignmentIds = [],
  monitorIds = [],
  moduleDefinitions = [],
  puedeEditarVistas = false,
}: {
  channelId: string;
  members: CollaboratorMember[];
  collaboratorIds: string[];
  pausedAssignmentIds?: string[];
  monitorIds?: string[];
  moduleDefinitions?: ModuleDefinition[];
  puedeEditarVistas?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(() =>
    collaboratorIds.filter((id) => members.some((m) => m.id === id)),
  );
  const [paused, setPaused] = useState<string[]>(() =>
    pausedAssignmentIds.filter((id) => collaboratorIds.includes(id)),
  );
  const [monitores, setMonitores] = useState<string[]>(() =>
    monitorIds.filter((id) => collaboratorIds.includes(id)),
  );
  const [isPending, startTransition] = useTransition();

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  // A quién estoy configurando. null = no hay ventana abierta.
  const [editando, setEditando] = useState<string | null>(null);
  const available = useMemo(() => members.filter((m) => !selected.includes(m.id)), [members, selected]);

  const addMember = (id: string) => {
    if (id && !selected.includes(id)) {
      setSelected((current) => [...current, id]);
    }
  };
  // Al sacar a alguien del canal se le limpia la pausa: si mañana vuelve, vuelve recibiendo.
  const removeMember = (id: string) => {
    setSelected((current) => current.filter((x) => x !== id));
    setPaused((current) => current.filter((x) => x !== id));
    setMonitores((current) => current.filter((x) => x !== id));
  };

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateChannelCollaboratorsAction({
        channelId,
        collaboratorIds: selected,
        pausedAssignmentIds: paused,
        monitorIds: monitores,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Colaboradores actualizados");
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Colaboradores</p>
        <p className="text-xs text-muted-foreground">
          Quiénes atienden este canal. Solo ellos ven sus chats.
        </p>
      </div>

      <div className="min-h-[44px] rounded-lg border border-input p-2">
        {selected.length ? (
          <div className="space-y-1">
            {selected.map((id) => {
              const member = memberById.get(id);
              if (!member) return null;
              const enPausa = paused.includes(id);
              const monitorea = monitores.includes(id);
              return (
                <div
                  key={id}
                  className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 text-[13px]"
                >
                  <span className="min-w-0 flex-1 truncate text-foreground">{memberLabel(member)}</span>
                  {/*
                    El interruptor dice lo que PASA, no lo que hay que hacer para cambiarlo: quien
                    mira la lista quiere saber de un vistazo a quién le está entrando trabajo.
                  */}
                  <button
                    type="button"
                    onClick={() => setEditando(id)}
                    title={
                      monitorea
                        ? "Ve TODOS los chats del canal y no puede escribir. Los números le salen tapados."
                        : enPausa
                          ? "No le entran leads nuevos. Sigue viendo el canal y sus chats."
                          : "Le entran leads nuevos por turno."
                    }
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                      monitorea
                        ? "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300"
                        : enPausa
                          ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                          : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                    }`}
                  >
                    {monitorea ? "Solo monitorea" : enPausa ? "En pausa" : "Recibe leads"}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeMember(id)}
                    aria-label={`Quitar ${memberLabel(member)} del canal`}
                    title="Quitar del canal (deja de ver estos chats)"
                    className="shrink-0 text-muted-foreground transition hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-1 py-1 text-sm text-muted-foreground">
            Sin colaboradores: este canal lo ve todo el equipo.
          </p>
        )}
      </div>

      {/*
        La diferencia entre las dos acciones no es obvia y equivocarse sale caro: sacar del canal a
        una asesora le vacía la bandeja sin avisarle. Se explica acá, al lado de los botones.
      */}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        <strong className="font-medium text-foreground">En pausa</strong> = deja de recibir leads
        nuevos, pero sigue viendo el canal y atendiendo los suyos.{" "}
        <strong className="font-medium text-foreground">Solo monitorea</strong> = ve todos los chats
        del canal para aprender cómo responde el agente, no puede escribir ni enviar nada, y los
        números le salen tapados. La{" "}
        <strong className="font-medium text-foreground">✕</strong> lo saca del canal y le esconde
        todos estos chats.
      </p>

      {editando ? (
        <ColaboradorDialog
          channelId={channelId}
          member={memberById.get(editando) ?? null}
          estado={
            monitores.includes(editando) ? "monitorea" : paused.includes(editando) ? "pausa" : "recibe"
          }
          moduleDefinitions={moduleDefinitions}
          puedeEditarVistas={puedeEditarVistas}
          onClose={() => setEditando(null)}
          onSaved={(estado) => {
            /*
              La lista se actualiza sin esperar al servidor.

              El `router.refresh()` que dispara la ventana tarda un instante, y ver la chapita
              vieja despues de haber guardado se lee como que no se guardo.
            */
            setEditando(null);
            setPaused((current) => {
              const sin = current.filter((x) => x !== editando);
              return estado === "recibe" ? sin : [...sin, editando];
            });
            setMonitores((current) => {
              const sin = current.filter((x) => x !== editando);
              return estado === "monitorea" ? [...sin, editando] : sin;
            });
          }}
        />
      ) : null}

      {available.length ? (
        <NativeSelect
          className="w-full"
          value=""
          onChange={(event) => addMember(event.target.value)}
          aria-label="Añadir colaborador"
        >
          <NativeSelectOption value="">+ Añadir colaborador…</NativeSelectOption>
          {available.map((member) => (
            <NativeSelectOption key={member.id} value={member.id}>
              {memberLabel(member)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : (
        <p className="text-xs text-muted-foreground">Todos los miembros del equipo ya están agregados.</p>
      )}

      <Button type="button" onClick={handleSave} disabled={isPending}>
        {isPending ? "Guardando…" : "Actualizar"}
      </Button>
    </div>
  );
}

/**
 * La ventana de una persona: que hace en este canal y que pantallas ve.
 *
 * Las dos cosas juntas porque son una sola pregunta -"que le dejo hacer"- y separarlas costaba
 * olvidos: se ponia "solo monitorea" aca y el numero salia igual por Contactos, porque las vistas
 * se editaban en otra pantalla.
 *
 * Guarda al instante, sin el boton "Actualizar" de la lista: ese es para agregar o sacar gente del
 * canal, y mezclar los dos guardados hacia que uno pisara al otro.
 */
function ColaboradorDialog({
  channelId,
  member,
  estado,
  moduleDefinitions,
  puedeEditarVistas,
  onClose,
  onSaved,
}: {
  channelId: string;
  member: CollaboratorMember | null;
  estado: EstadoEnElCanal;
  moduleDefinitions: ModuleDefinition[];
  puedeEditarVistas: boolean;
  onClose: () => void;
  onSaved: (estado: EstadoEnElCanal) => void;
}) {
  const router = useRouter();
  const [elegido, setElegido] = useState<EstadoEnElCanal>(estado);
  const [vistas, setVistas] = useState<string[]>(() => member?.moduleAccess ?? []);
  const [isPending, startTransition] = useTransition();

  const puedeTocarVistas = puedeEditarVistas && Boolean(member?.editableModules);

  const alternarVista = (clave: string) =>
    setVistas((current) =>
      current.includes(clave) ? current.filter((x) => x !== clave) : [...current, clave],
    );

  const guardar = () => {
    if (!member) {
      return;
    }
    startTransition(async () => {
      const result = await actualizarColaboradorDelCanalAction({
        channelId,
        userId: member.id,
        estado: elegido,
        modulos: puedeTocarVistas ? vistas : null,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Listo");
      onSaved(elegido);
      router.refresh();
    });
  };

  return (
    <Dialog open={Boolean(member)} onOpenChange={(abierto) => (abierto ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">{member ? memberLabel(member) : "Colaborador"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              En este canal
            </p>
            <div className="space-y-1.5">
              {ESTADOS.map((opcion) => (
                <button
                  key={opcion.valor}
                  type="button"
                  onClick={() => setElegido(opcion.valor)}
                  className={`flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition ${
                    elegido === opcion.valor
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/60"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 size-3.5 shrink-0 rounded-full border-2 ${
                      elegido === opcion.valor ? "border-primary bg-primary" : "border-muted-foreground/40"
                    }`}
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-foreground">{opcion.titulo}</span>
                    <span className="block text-[12px] leading-snug text-muted-foreground">
                      {opcion.detalle}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {puedeTocarVistas ? (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Qué pantallas ve {member ? memberLabel(member) : ""}
              </p>
              {/*
                Se dice de quien son estas casillas, y hasta donde llegan.

                Son dos malentendidos distintos y los dos salen caros. Uno: parece que fueran del
                canal, y no -son de la persona en todo el CRM-. Dos, el que importa: parece que
                destildar "Contactos" se lo quitara a TODO el equipo. Es por persona: quitarselo a
                una no se lo toca a las demas.
              */}
              <p className="text-[11px] leading-snug text-muted-foreground">
                Solo afectan a esta persona: destildar una no se la quita a nadie más. Valen para
                toda la aplicación, no solo para este canal.
              </p>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-1.5">
                {moduleDefinitions.map((modulo) => {
                  const marcado = vistas.includes(modulo.key);
                  return (
                    <label
                      key={modulo.key}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition hover:bg-muted/60"
                    >
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => alternarVista(modulo.key)}
                        className="size-4 shrink-0 accent-[var(--primary)]"
                      />
                      <span className="min-w-0 truncate text-foreground">{modulo.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
          <Button type="button" onClick={guardar} disabled={isPending || !member}>
            {isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
