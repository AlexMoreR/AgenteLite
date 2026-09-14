"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Play, Plus, Trash2, UserRoundCheck, Workflow } from "lucide-react";
import { toast } from "sonner";

import {
  borrarAutomatizacionAction,
  contarAutomatizacionAction,
  ejecutarAutomatizacionAction,
  guardarAutomatizacionAction,
} from "@/app/actions/automatizaciones-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type {
  AutomatizacionDeAsignacion,
  BorradorDeAutomatizacion,
} from "@/features/crm/automatizaciones/tipos";
import { CRM_STAGE_ORDER, getCrmStageMeta } from "../domain/crm-config";
import type { CrmStage } from "../types";

type Persona = { id: string; nombre: string };
type Canal = { id: string; nombre: string };
type Conteo = { total: number; tomaria: number; noLoVeria: number };

const BORRADOR_VACIO: BorradorDeAutomatizacion = {
  nombre: "",
  dueno: "sin_asignar",
  etapas: [],
  canalId: null,
  diasSinMensajes: null,
  soloAbiertas: true,
  cantidad: null,
  asignarA: "",
};

function fechaCorta(iso: string) {
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );
}

function ChapaDeEtapa({ etapa }: { etapa: CrmStage }) {
  const meta = getCrmStageMeta(etapa);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.backgroundClassName} ${meta.borderClassName} ${meta.accentClassName}`}
    >
      {meta.label}
    </span>
  );
}

function Pastilla({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

export function AutomatizacionesWorkspace({
  automatizaciones,
  conteos,
  miembros,
  canales,
}: {
  automatizaciones: AutomatizacionDeAsignacion[];
  conteos: Conteo[];
  miembros: Persona[];
  canales: Canal[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editor, setEditor] = useState<BorradorDeAutomatizacion | null>(null);
  const [previa, setPrevia] = useState<Conteo | null>(null);
  const [porEjecutar, setPorEjecutar] = useState<{ automatizacion: AutomatizacionDeAsignacion; conteo: Conteo } | null>(
    null,
  );

  const nombreDe = useMemo(() => new Map(miembros.map((persona) => [persona.id, persona.nombre])), [miembros]);
  const canalDe = useMemo(() => new Map(canales.map((canal) => [canal.id, canal.nombre])), [canales]);

  /*
    El numero se actualiza MIENTRAS se arma la automatizacion.

    Es lo que evita la sorpresa: antes de guardar ya se ve "va a tomar 143 leads", y si eran 3 los
    que se esperaban, se nota que falta un filtro.
  */
  useEffect(() => {
    if (!editor || !editor.asignarA) {
      return;
    }
    const temporizador = window.setTimeout(() => {
      void contarAutomatizacionAction({ ...editor, nombre: editor.nombre.trim() || "borrador" }).then((respuesta) => {
        setPrevia("error" in respuesta ? null : respuesta);
      });
    }, 350);
    return () => window.clearTimeout(temporizador);
  }, [editor]);

  const abrirEditor = (borrador: BorradorDeAutomatizacion) => {
    setPrevia(null);
    setEditor(borrador);
  };

  const guardar = () => {
    if (!editor) return;
    startTransition(async () => {
      const respuesta = await guardarAutomatizacionAction(editor);
      if ("error" in respuesta && respuesta.error) {
        toast.error(respuesta.error);
        return;
      }
      toast.success("Automatización guardada");
      setEditor(null);
      router.refresh();
    });
  };

  const borrar = (automatizacion: AutomatizacionDeAsignacion) => {
    if (!window.confirm(`¿Borrar la automatización «${automatizacion.nombre}»?`)) return;
    startTransition(async () => {
      const respuesta = await borrarAutomatizacionAction(automatizacion.id);
      if ("error" in respuesta && respuesta.error) {
        toast.error(respuesta.error);
        return;
      }
      router.refresh();
    });
  };

  const ejecutar = () => {
    if (!porEjecutar) return;
    startTransition(async () => {
      const respuesta = await ejecutarAutomatizacionAction(porEjecutar.automatizacion.id);
      setPorEjecutar(null);
      if ("error" in respuesta && respuesta.error) {
        toast.error(respuesta.error);
        return;
      }
      if ("asignados" in respuesta) {
        toast.success(
          respuesta.asignados === 0
            ? "No había leads para asignar"
            : `${respuesta.asignados} leads asignados a ${respuesta.destinoNombre}`,
        );
      }
      router.refresh();
    });
  };

  const alternarEtapa = (etapa: CrmStage) => {
    if (!editor) return;
    setEditor({
      ...editor,
      etapas: editor.etapas.includes(etapa) ? editor.etapas.filter((valor) => valor !== etapa) : [...editor.etapas, etapa],
    });
  };

  const textoDelDueno = (dueno: AutomatizacionDeAsignacion["dueno"]) =>
    dueno === "sin_asignar"
      ? "Sin asignar"
      : dueno === "cualquiera"
        ? "De cualquiera"
        : `De ${nombreDe.get(dueno.slice(3)) ?? "alguien que ya no está"}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button onClick={() => abrirEditor(BORRADOR_VACIO)}>
          <Plus className="size-4" /> Nueva automatización
        </Button>
      </div>

      {automatizaciones.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <Workflow className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Todavía no hay automatizaciones</p>
          <p className="max-w-sm text-[13px] text-muted-foreground">
            Por ejemplo: todos los leads sin asignar para una asesora, o 20 que llevan 3 días sin mensajes.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {automatizaciones.map((automatizacion, indice) => {
            const conteo = conteos[indice] ?? { total: 0, tomaria: 0, noLoVeria: 0 };
            return (
              <div key={automatizacion.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{automatizacion.nombre}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Editar"
                      onClick={() => abrirEditor(automatizacion)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Borrar" onClick={() => borrar(automatizacion)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Pastilla>{textoDelDueno(automatizacion.dueno)}</Pastilla>
                  {automatizacion.etapas.map((etapa) => (
                    <ChapaDeEtapa key={etapa} etapa={etapa} />
                  ))}
                  {automatizacion.canalId ? <Pastilla>{canalDe.get(automatizacion.canalId) ?? "Canal borrado"}</Pastilla> : null}
                  {automatizacion.diasSinMensajes ? (
                    <Pastilla>{automatizacion.diasSinMensajes}+ días sin mensajes</Pastilla>
                  ) : null}
                  {automatizacion.soloAbiertas ? null : <Pastilla>Incluye resueltos</Pastilla>}
                </div>

                <div className="flex items-center gap-2 text-[13px] text-foreground">
                  <UserRoundCheck className="size-4 text-[var(--primary)]" />
                  <span>
                    {automatizacion.cantidad ? `Hasta ${automatizacion.cantidad}` : "Todos"} para{" "}
                    <span className="font-semibold">{nombreDe.get(automatizacion.asignarA) ?? "alguien que ya no está"}</span>
                  </span>
                </div>

                <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
                  <div className="min-w-0">
                    <p className="text-[13px] text-foreground">
                      <span className="text-lg font-semibold tabular-nums">{conteo.tomaria}</span> leads ahora
                    </p>
                    {automatizacion.ultimaEjecucion ? (
                      <p className="truncate text-[11px] text-muted-foreground">
                        Última: {fechaCorta(automatizacion.ultimaEjecucion.fecha)} · {automatizacion.ultimaEjecucion.asignados}{" "}
                        asignados
                      </p>
                    ) : null}
                  </div>
                  <Button
                    disabled={isPending || conteo.tomaria === 0}
                    onClick={() => setPorEjecutar({ automatizacion, conteo })}
                  >
                    <Play className="size-4" /> Ejecutar
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmar: mover leads en cantidad no se deshace con un clic. */}
      <Dialog open={Boolean(porEjecutar)} onOpenChange={(abierto) => (!abierto ? setPorEjecutar(null) : undefined)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>¿Ejecutar «{porEjecutar?.automatizacion.nombre}»?</DialogTitle>
            <DialogDescription>
              Se van a asignar <span className="font-semibold text-foreground">{porEjecutar?.conteo.tomaria}</span> leads a{" "}
              <span className="font-semibold text-foreground">
                {porEjecutar ? nombreDe.get(porEjecutar.automatizacion.asignarA) : ""}
              </span>
              . En cada chat queda la nota de la asignación.
            </DialogDescription>
          </DialogHeader>
          {porEjecutar && porEjecutar.conteo.noLoVeria > 0 ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              {porEjecutar.conteo.noLoVeria} son de un canal donde esa persona no es colaboradora: no los va a ver en su
              bandeja hasta que la agregues al canal.
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPorEjecutar(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={ejecutar} disabled={isPending}>
              {isPending ? "Asignando…" : "Asignar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editor */}
      <Dialog open={Boolean(editor)} onOpenChange={(abierto) => (!abierto ? setEditor(null) : undefined)}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editor?.id ? "Editar automatización" : "Nueva automatización"}</DialogTitle>
            <DialogDescription>Elige qué leads se toman y a quién se asignan.</DialogDescription>
          </DialogHeader>

          {editor ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Nombre</Label>
                <Input
                  value={editor.nombre}
                  onChange={(evento) => setEditor({ ...editor, nombre: evento.target.value })}
                  placeholder="Ej. Descartados para Genesis"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>De quién son hoy</Label>
                  <NativeSelect
                    value={editor.dueno}
                    onChange={(evento) =>
                      setEditor({ ...editor, dueno: evento.target.value as BorradorDeAutomatizacion["dueno"] })
                    }
                  >
                    <NativeSelectOption value="sin_asignar">Sin asignar</NativeSelectOption>
                    <NativeSelectOption value="cualquiera">De cualquiera</NativeSelectOption>
                    {miembros.map((persona) => (
                      <NativeSelectOption key={persona.id} value={`de:${persona.id}`}>
                        De {persona.nombre}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>

                <div className="space-y-1">
                  <Label>Canal</Label>
                  <NativeSelect
                    value={editor.canalId ?? ""}
                    onChange={(evento) => setEditor({ ...editor, canalId: evento.target.value || null })}
                  >
                    <NativeSelectOption value="">Todos</NativeSelectOption>
                    {canales.map((canal) => (
                      <NativeSelectOption key={canal.id} value={canal.id}>
                        {canal.nombre}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Etapa</Label>
                <div className="flex flex-wrap gap-1.5">
                  {CRM_STAGE_ORDER.map((etapa) => {
                    const meta = getCrmStageMeta(etapa);
                    const activa = editor.etapas.includes(etapa);
                    return (
                      <button
                        key={etapa}
                        type="button"
                        onClick={() => alternarEtapa(etapa)}
                        className={`rounded-full border px-3 py-1 text-[12px] font-medium transition ${
                          activa
                            ? `${meta.backgroundClassName} ${meta.borderClassName} ${meta.accentClassName}`
                            : "border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground">Sin marcar ninguna: cualquier etapa.</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Días sin mensajes</Label>
                  <Input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={editor.diasSinMensajes ?? ""}
                    onChange={(evento) =>
                      setEditor({ ...editor, diasSinMensajes: evento.target.value ? Number(evento.target.value) : null })
                    }
                    placeholder="No importa"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Cantidad</Label>
                  <Input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={editor.cantidad ?? ""}
                    onChange={(evento) =>
                      setEditor({ ...editor, cantidad: evento.target.value ? Number(evento.target.value) : null })
                    }
                    placeholder="Todos"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-[13px] text-foreground">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={editor.soloAbiertas}
                  onChange={(evento) => setEditor({ ...editor, soloAbiertas: evento.target.checked })}
                />
                Solo chats abiertos
              </label>

              <div className="space-y-1">
                <Label>Asignar a</Label>
                <NativeSelect
                  value={editor.asignarA}
                  onChange={(evento) => setEditor({ ...editor, asignarA: evento.target.value })}
                >
                  <NativeSelectOption value="">Elige una persona</NativeSelectOption>
                  {miembros.map((persona) => (
                    <NativeSelectOption key={persona.id} value={persona.id}>
                      {persona.nombre}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>

              {editor.asignarA && previa ? (
                <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-[13px] text-foreground">
                  Va a tomar <span className="font-semibold tabular-nums">{previa.tomaria}</span> leads
                  {previa.total > previa.tomaria ? ` de ${previa.total} que cumplen` : ""}.
                  {previa.noLoVeria > 0 ? (
                    <span className="block text-[12px] text-amber-700 dark:text-amber-300">
                      {previa.noLoVeria} son de un canal donde esa persona no es colaboradora.
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={guardar} disabled={isPending || !editor?.nombre.trim() || !editor?.asignarA}>
              {isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
