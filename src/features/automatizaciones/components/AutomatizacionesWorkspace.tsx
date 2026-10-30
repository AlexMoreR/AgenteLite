"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, MessageSquareText, Pencil, Play, Plus, Square, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";

import {
  borrarAutomatizacionAction,
  cambiarAutomaticaAction,
  detenerEnviosAction,
  ejecutarAutomatizacionAction,
  guardarAutomatizacionAction,
  vistaPreviaAction,
} from "@/app/actions/automatizaciones-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import type { Conteo, EstadoDeEnvios, LeadDeLaVistaPrevia } from "@/features/automatizaciones/servicio";
import {
  RITMO_POR_DEFECTO,
  SIN_ASIGNAR,
  TIPOS_DE_ACCION,
  nombreDePasoDelEmbudo,
  problemaDelBorrador,
  tieneEnvios,
  type Accion,
  type Automatizacion,
  type BorradorDeAutomatizacion,
  type Condicion,
} from "@/features/automatizaciones/tipos";
import { getCrmStageMeta } from "@/features/crm/domain/crm-config";
import type { CrmStage } from "@/features/crm/types";

import { EditorDeAutomatizacion, type Catalogos, type Opcion } from "./EditorDeAutomatizacion";

const BORRADOR_VACIO: BorradorDeAutomatizacion = {
  nombre: "",
  condiciones: [],
  soloAbiertas: true,
  cantidad: null,
  acciones: [],
  automatica: false,
  ritmo: RITMO_POR_DEFECTO,
};

function fechaCorta(iso: string) {
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" }).format(
    new Date(iso),
  );
}

function enlaceDelChat(conversationId: string) {
  return `/cliente/chats?chatKey=${encodeURIComponent(`agent:${conversationId}`)}&assigned=all`;
}

function Pastilla({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

type Mapas = { personas: Map<string, string>; canales: Map<string, string>; etiquetas: Map<string, string> };

function nombresDe(ids: string[], mapa: Map<string, string>, especial?: Record<string, string>) {
  return ids.map((id) => especial?.[id] ?? mapa.get(id) ?? "borrado").join(", ");
}

function textoDeCondicion(c: Condicion, m: Mapas): string {
  switch (c.campo) {
    case "etapa":
      return `Etapa ${c.operador === "es" ? "" : "no "}${c.valores.map((e) => getCrmStageMeta(e as CrmStage).label).join(", ")}`;
    case "asignado":
      return `${c.operador === "es" ? "De" : "No de"} ${nombresDe(c.valores, m.personas, { [SIN_ASIGNAR]: "sin asignar" })}`;
    case "etiquetas":
      return `${c.operador === "tiene" ? "Con" : "Sin"} ${nombresDe(c.valores, m.etiquetas)}`;
    case "canal":
      return `${c.operador === "es" ? "" : "No "}${nombresDe(c.valores, m.canales)}`;
    case "dias_sin_responder":
      return `${c.dias}+ días sin responder`;
    case "dias_sin_mensajes":
      return `${c.dias}+ días sin mensajes`;
    case "recuperacion_vencida":
      return c.operador === "si" ? "Recuperación vencida" : "Sin recuperación vencida";
    case "paso_embudo":
      return `Paso del embudo ${c.operador === "es" ? "es" : "ya pasó"} ${c.valores.map(nombreDePasoDelEmbudo).join(", ")}`;
  }
}

function textoDeAccion(a: Accion, m: Mapas): string {
  const etiqueta = TIPOS_DE_ACCION.find((t) => t.tipo === a.tipo)?.etiqueta ?? a.tipo;
  switch (a.tipo) {
    case "asignar":
      return `Asignar a ${m.personas.get(a.usuarioId) ?? "alguien que ya no está"}`;
    case "anadir_etiqueta":
    case "quitar_etiqueta":
      return `${etiqueta} «${m.etiquetas.get(a.etiquetaId) ?? "borrada"}»`;
    case "posponer":
      return a.hasta ? `Posponer hasta ${fechaCorta(a.hasta)}` : `Posponer ${a.dias} d`;
    case "enviar_flujo":
      return `Enviar flujo «${a.flujoNombre || "flujo"}»`;
    case "enviar_texto":
      return `Enviar texto: «${a.texto.length > 40 ? `${a.texto.slice(0, 40)}…` : a.texto}»`;
    case "nota":
      return "Añadir nota";
    case "cambiar_etapa":
      return `Etapa → ${getCrmStageMeta(a.etapa).label}`;
    default:
      return etiqueta;
  }
}

type VistaPrevia = { automatizacion: Automatizacion; conteo: Conteo; leads: LeadDeLaVistaPrevia[] };

export function AutomatizacionesWorkspace({
  automatizaciones,
  conteos,
  miembros,
  canales,
  etiquetas,
  flujos,
  envios,
}: {
  automatizaciones: Automatizacion[];
  conteos: Conteo[];
  miembros: Opcion[];
  canales: Opcion[];
  etiquetas: Opcion[];
  flujos: Opcion[];
  envios: Record<string, EstadoDeEnvios>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editor, setEditor] = useState<BorradorDeAutomatizacion | null>(null);
  const [previa, setPrevia] = useState<VistaPrevia | null>(null);
  const [porEjecutar, setPorEjecutar] = useState<{ automatizacion: Automatizacion; conteo: Conteo } | null>(null);

  const catalogos: Catalogos = { miembros, canales, etiquetas, flujos };
  const mapas: Mapas = useMemo(
    () => ({
      personas: new Map(miembros.map((p) => [p.id, p.nombre])),
      canales: new Map(canales.map((c) => [c.id, c.nombre])),
      etiquetas: new Map(etiquetas.map((t) => [t.id, t.nombre])),
    }),
    [miembros, canales, etiquetas],
  );

  const guardar = () => {
    if (!editor) return;
    const problema = problemaDelBorrador(editor);
    if (problema) {
      toast.error(problema);
      return;
    }
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

  const borrar = (automatizacion: Automatizacion) => {
    if (!window.confirm(`¿Borrar la automatización «${automatizacion.nombre}»? Los envíos que tenga en cola se cancelan.`)) return;
    startTransition(async () => {
      const respuesta = await borrarAutomatizacionAction(automatizacion.id);
      if ("error" in respuesta && respuesta.error) toast.error(respuesta.error);
      router.refresh();
    });
  };

  const verPrevia = (automatizacion: Automatizacion) => {
    startTransition(async () => {
      const respuesta = await vistaPreviaAction({ id: automatizacion.id });
      if ("error" in respuesta) {
        toast.error(respuesta.error);
        return;
      }
      setPrevia({ automatizacion, conteo: respuesta.conteo, leads: respuesta.leads });
    });
  };

  const cambiarAutomatica = (automatizacion: Automatizacion, automatica: boolean) => {
    startTransition(async () => {
      const respuesta = await cambiarAutomaticaAction(automatizacion.id, automatica);
      if ("error" in respuesta && respuesta.error) toast.error(respuesta.error);
      else toast.success(automatica ? "Ahora corre sola cada 30 min" : "Automática apagada");
      router.refresh();
    });
  };

  const detener = (automatizacion: Automatizacion) => {
    if (!window.confirm("¿Cancelar los envíos que todavía están en cola?")) return;
    startTransition(async () => {
      const respuesta = await detenerEnviosAction(automatizacion.id);
      if ("error" in respuesta && respuesta.error) toast.error(respuesta.error);
      else if ("detenidos" in respuesta) toast.success(`${respuesta.detenidos} envíos cancelados`);
      router.refresh();
    });
  };

  const ejecutar = () => {
    if (!porEjecutar) return;
    startTransition(async () => {
      const respuesta = await ejecutarAutomatizacionAction(porEjecutar.automatizacion.id);
      setPorEjecutar(null);
      setPrevia(null);
      if ("error" in respuesta && respuesta.error) {
        toast.error(respuesta.error);
      } else if ("leads" in respuesta) {
        const partes = [respuesta.leads === 0 ? "No había leads" : `${respuesta.leads} leads procesados`];
        if (respuesta.envios) partes.push(`${respuesta.envios} envíos en cola`);
        if (respuesta.errores) partes.push(`${respuesta.errores} con error`);
        toast.success(partes.join(" · "));
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button onClick={() => setEditor(BORRADOR_VACIO)}>
          <Plus className="size-4" /> Nueva automatización
        </Button>
      </div>

      {automatizaciones.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <Workflow className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Todavía no hay automatizaciones</p>
          <p className="max-w-sm text-[13px] text-muted-foreground">
            Por ejemplo: recuperación vencida de María → enviar un audio y un texto.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {automatizaciones.map((automatizacion, indice) => {
            const conteo = conteos[indice] ?? { total: 0, tomaria: 0, noLoVeria: 0 };
            const estado = envios[automatizacion.id.slice(0, 6)];
            const ultima = automatizacion.historial[0];
            return (
              <div key={automatizacion.id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 text-[13px]">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-sm font-semibold text-foreground">{automatizacion.nombre}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon-sm" aria-label="Editar" onClick={() => setEditor(automatizacion)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Borrar" onClick={() => borrar(automatizacion)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Si</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {automatizacion.condiciones.length === 0 ? <Pastilla>Todos los leads</Pastilla> : null}
                    {automatizacion.condiciones.map((c, i) => (
                      <Pastilla key={i}>{textoDeCondicion(c, mapas)}</Pastilla>
                    ))}
                    {automatizacion.soloAbiertas ? null : <Pastilla>Incluye resueltos</Pastilla>}
                    {automatizacion.cantidad ? <Pastilla>Máx. {automatizacion.cantidad}</Pastilla> : null}
                  </div>
                  <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Entonces</p>
                  <ol className="space-y-0.5 text-[13px] text-foreground">
                    {automatizacion.acciones.map((a, i) => (
                      <li key={i} className="truncate">
                        {i + 1}. {textoDeAccion(a, mapas)}
                      </li>
                    ))}
                  </ol>
                </div>

                <label className="flex items-center justify-between gap-2 text-[13px] text-foreground">
                  <span>
                    Automática <span className="text-[11px] text-muted-foreground">(cada 30 min)</span>
                  </span>
                  <Switch
                    checked={automatizacion.automatica}
                    disabled={isPending}
                    onCheckedChange={(valor) => cambiarAutomatica(automatizacion, valor)}
                  />
                </label>

                {estado && (estado.pendientes || estado.enviados || estado.frenados || estado.fallidos) ? (
                  <div className="flex items-start justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-2 text-[12px] text-foreground">
                    <span className="flex items-start gap-1.5">
                      <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <span>
                        {estado.pendientes} en cola · {estado.enviados} enviados
                        {estado.frenados ? ` · ${estado.frenados} frenados` : ""}
                        {estado.fallidos ? ` · ${estado.fallidos} con error` : ""}
                        {estado.pendientes && estado.proximoEn ? (
                          <span className="block text-[11px] text-muted-foreground">Próximo: {fechaCorta(estado.proximoEn)}</span>
                        ) : null}
                      </span>
                    </span>
                    {estado.pendientes ? (
                      <Button variant="ghost" size="xs" onClick={() => detener(automatizacion)} disabled={isPending}>
                        <Square className="size-3" /> Detener
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-auto space-y-2 border-t border-border pt-3">
                  <div className="min-w-0">
                    <p className="text-[13px] text-foreground">
                      <span className="text-lg font-semibold tabular-nums">{conteo.tomaria}</span> leads ahora
                    </p>
                    {ultima ? (
                      <p className="text-[11px] text-muted-foreground">
                        Última: {fechaCorta(ultima.fecha)} ({ultima.origen === "automatica" ? "automática" : ultima.por}) · {ultima.leads} leads
                        {ultima.envios ? ` · ${ultima.envios} envíos` : ""}
                        {ultima.errores ? ` · ${ultima.errores} errores` : ""}
                      </p>
                    ) : null}
                    {ultima?.detalle.length ? <p className="text-[11px] text-amber-700 dark:text-amber-300">{ultima.detalle[0]}</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" disabled={isPending} onClick={() => verPrevia(automatizacion)}>
                      <Eye className="size-4" /> Vista previa
                    </Button>
                    <Button className="flex-1" disabled={isPending || conteo.tomaria === 0} onClick={() => setPorEjecutar({ automatizacion, conteo })}>
                      <Play className="size-4" /> Ejecutar
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Vista previa: cuántos y cuáles, con su chat. */}
      <Dialog open={Boolean(previa)} onOpenChange={(abierto) => (!abierto ? setPrevia(null) : undefined)}>
        <DialogContent className="h-[100dvh] max-h-[100dvh] w-screen max-w-none rounded-none ring-0 sm:h-auto sm:max-h-[90dvh] sm:w-full sm:max-w-3xl sm:rounded-xl sm:ring-1 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Vista previa · {previa?.automatizacion.nombre}</DialogTitle>
            <DialogDescription>
              Cumplen hoy <span className="font-semibold text-foreground">{previa?.conteo.total ?? 0}</span>
              {previa && previa.conteo.total > previa.conteo.tomaria ? ` (toma ${previa.conteo.tomaria})` : ""}. Sin los que ya procesó.
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {previa?.leads.length === 0 ? <li className="px-3 py-4 text-center text-[13px] text-muted-foreground">Ninguno</li> : null}
            {previa?.leads.map((lead) => (
              <li key={lead.conversationId} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-foreground">
                    {lead.nombre}
                    {lead.telefonoFinal ? <span className="text-muted-foreground"> ···{lead.telefonoFinal}</span> : null}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {getCrmStageMeta(lead.etapa as CrmStage).label} · {lead.asesora ?? "sin asignar"}
                    {lead.linea ? ` · ${lead.linea}` : ""}
                    {lead.ultimoClienteEn ? ` · escribió ${fechaCorta(lead.ultimoClienteEn)}` : ""}
                    {lead.recuperacionVencida ? " · 72 h vencida" : ""}
                  </p>
                </div>
                <a
                  href={enlaceDelChat(lead.conversationId)}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-lg border border-border px-2 py-1 text-[12px] font-medium text-foreground hover:bg-muted"
                >
                  Abrir chat
                </a>
              </li>
            ))}
          </ul>
          {previa && previa.conteo.total > previa.leads.length ? (
            <p className="text-[11px] text-muted-foreground">Se muestran los primeros {previa.leads.length}.</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrevia(null)}>
              Cerrar
            </Button>
            <Button
              disabled={isPending || !previa || previa.conteo.tomaria === 0}
              onClick={() => {
                if (!previa) return;
                setPorEjecutar({ automatizacion: previa.automatizacion, conteo: previa.conteo });
                setPrevia(null);
              }}
            >
              <Play className="size-4" /> Ejecutar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar: lo que se hace en cantidad no se deshace con un clic. */}
      <Dialog open={Boolean(porEjecutar)} onOpenChange={(abierto) => (!abierto ? setPorEjecutar(null) : undefined)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>¿Ejecutar «{porEjecutar?.automatizacion.nombre}»?</DialogTitle>
            <DialogDescription>
              Se aplican las acciones a <span className="font-semibold text-foreground">{porEjecutar?.conteo.tomaria}</span> leads. En cada
              chat queda una nota.
            </DialogDescription>
          </DialogHeader>
          {porEjecutar && tieneEnvios(porEjecutar.automatizacion.acciones) ? (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] text-foreground">
              Los mensajes salen de a {porEjecutar.automatizacion.ritmo.tanda} cada {porEjecutar.automatizacion.ritmo.cadaMinutos} min, de 8:00 a
              20:00, con el anti-bloqueo. Al salir, la tarea de llamada 72 h queda hecha.
            </p>
          ) : null}
          {porEjecutar && porEjecutar.conteo.noLoVeria > 0 ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              {porEjecutar.conteo.noLoVeria} son de un canal donde la persona a asignar no es colaboradora: no los va a ver en su bandeja.
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPorEjecutar(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={ejecutar} disabled={isPending}>
              {isPending ? "Ejecutando…" : `Ejecutar (${porEjecutar?.conteo.tomaria ?? 0})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editor */}
      <Dialog open={Boolean(editor)} onOpenChange={(abierto) => (!abierto ? setEditor(null) : undefined)}>
        <DialogContent className="h-[100dvh] max-h-[100dvh] w-screen max-w-none rounded-none ring-0 sm:h-auto sm:max-h-[90dvh] sm:w-full sm:max-w-3xl sm:rounded-xl sm:ring-1 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editor?.id ? "Editar automatización" : "Nueva automatización"}</DialogTitle>
            <DialogDescription className="sr-only">Si se cumplen las condiciones, se hacen las acciones.</DialogDescription>
          </DialogHeader>
          {editor ? <EditorDeAutomatizacion borrador={editor} catalogos={catalogos} onCambio={setEditor} /> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={guardar} disabled={isPending || !editor?.nombre.trim() || !editor?.acciones.length}>
              {isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
