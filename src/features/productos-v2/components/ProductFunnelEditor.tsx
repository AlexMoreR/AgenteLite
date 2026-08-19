"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { saveProductFunnelAction } from "@/app/actions/product-playbook-actions";
import { PRODUCT_FUNNEL_STAGES } from "@/lib/product-funnel-stages";
import { StageFollowUpDialog, type SeguimientoDeEtapa } from "./StageFollowUpDialog";

type EtapaEditable = {
  stage: string;
  goal: string;
  script: string;
  /** Los "si no contesta" de esta etapa, en orden. Vacio = sin seguimiento. */
  followUps: SeguimientoDeEtapa[];
};

const UNIDAD_CORTA: Record<SeguimientoDeEtapa["timeType"], string> = {
  MINUTES: "min",
  HOURS: "h",
  DAYS: "d",
};

type LeadDeEtapa = {
  conversationId: string;
  nombre: string;
  telefono: string;
  mensajes: number;
  ultimo: string | null;
  href: string;
};

/**
 * El embudo de ventas del producto, en sus cinco etapas.
 *
 * Plegado y de a una: las cinco etapas abiertas eran diez campos juntos, y una pantalla asi no se
 * llena —se cierra. Cerradas, cada etapa muestra en una linea lo que ya dice, asi el embudo se
 * puede LEER de un vistazo, que es como se revisa una venta.
 *
 * Son las mismas etapas con las que ya trabaja el motor, pero editables desde aca y aplicadas al
 * responder: antes vivian dentro del diagrama del agente y habia que republicar.
 */
export function ProductFunnelEditor({
  productId,
  stages,
  vienenDelAgente,
  avance,
}: {
  productId: string;
  stages: Array<{
    stage: string;
    goal: string;
    script: string;
    followUps: Array<{
      id: string;
      timeType: "MINUTES" | "HOURS" | "DAYS";
      timeValue: number;
      content: string;
      cancelOnActivity: boolean;
    }>;
  }>;
  /** El texto se trajo del embudo que el agente ya tenia y todavia no se guardo aca. */
  vienenDelAgente: boolean;
  /** Hasta donde llegaron los leads en los ultimos 30 dias. */
  avance: {
    murioPrimero: number;
    mandoDos: number;
    converso: number;
    larga: number;
    total: number;
  } | null;
}) {
  const router = useRouter();
  const [etapas, setEtapas] = useState<EtapaEditable[]>(() =>
    PRODUCT_FUNNEL_STAGES.map((meta) => {
      const guardada = stages.find((etapa) => etapa.stage === meta.stage);
      return {
        stage: meta.stage,
        goal: guardada?.goal ?? "",
        script: guardada?.script ?? "",
        followUps: (guardada?.followUps ?? []).map((seguimiento) => ({
          key: seguimiento.id,
          timeType: seguimiento.timeType,
          timeValue: String(seguimiento.timeValue),
          content: seguimiento.content,
          cancelOnActivity: seguimiento.cancelOnActivity,
        })),
      };
    }),
  );
  const [editando, setEditando] = useState<{
    stage: string;
    etiqueta: string;
    seguimiento: SeguimientoDeEtapa | null;
  } | null>(null);
  const [guardado, setGuardado] = useState(() => JSON.stringify(etapas));
  const [ocupado, setOcupado] = useState(false);
  const [etapaAbierta, setEtapaAbierta] = useState<{
    etiqueta: string;
    criterio: string;
    leads: LeadDeEtapa[];
    cargando: boolean;
  } | null>(null);

  const hayCambios = JSON.stringify(etapas) !== guardado;
  const escritas = etapas.filter((etapa) => etapa.goal || etapa.script).length;

  /**
   * Cuantos leads se fueron sin pasar de cada etapa, en los ultimos 30 dias.
   *
   * Se deduce de cuantos mensajes mando el cliente, que es un hecho y no una interpretacion: con
   * un solo mensaje no paso de la apertura, con dos no paso de identificar. El CIERRE queda sin
   * numero porque con este dato no se puede saber — y poner uno inventado es justo lo que hacia el
   * conteo por etapa que sacamos.
   */
  const perdidosEnEtapa: Record<string, { valor: number; pct: number } | undefined> = {};
  if (avance && avance.total > 0) {
    const pct = (valor: number) => Math.round((valor / avance.total) * 100);
    perdidosEnEtapa.PRESENTACION = { valor: avance.murioPrimero, pct: pct(avance.murioPrimero) };
    perdidosEnEtapa.IDENTIFICACION = { valor: avance.mandoDos, pct: pct(avance.mandoDos) };
    perdidosEnEtapa.PRODUCTO = { valor: avance.converso, pct: pct(avance.converso) };
    perdidosEnEtapa.OBJECIONES = { valor: avance.larga, pct: pct(avance.larga) };
  }

  // Se abre en la primera etapa que falta: es la que hay que trabajar.
  const [abierta] = useState<string[]>(() => {
    const pendiente = PRODUCT_FUNNEL_STAGES.find((meta) => {
      const etapa = stages.find((item) => item.stage === meta.stage);
      return !etapa?.goal && !etapa?.script;
    });
    return [pendiente?.stage ?? PRODUCT_FUNNEL_STAGES[0].stage];
  });

  /**
   * Abrir la lista de leads que se quedaron en una etapa.
   *
   * Los grupos son los mismos cortes con los que se calculo el numero (cuantos mensajes mando el
   * cliente); si cambian en getProductLeadProgress, cambian aca.
   */
  const GRUPO_POR_ETAPA: Record<string, string> = {
    PRESENTACION: "primero",
    IDENTIFICACION: "dos",
    PRODUCTO: "converso",
    OBJECIONES: "larga",
  };

  const abrirLeads = async (stage: string, etiqueta: string) => {
    const grupo = GRUPO_POR_ETAPA[stage];
    if (!grupo) {
      return;
    }
    setEtapaAbierta({ etiqueta, criterio: "", leads: [], cargando: true });
    try {
      const respuesta = await fetch(
        `/api/cliente/productos-v2/leads-etapa?productId=${encodeURIComponent(productId)}&grupo=${grupo}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      const datos = (await respuesta.json()) as {
        ok?: boolean;
        criterio?: string;
        leads?: LeadDeEtapa[];
      };
      if (!datos.ok) {
        toast.error("No se pudo traer la lista");
        setEtapaAbierta(null);
        return;
      }
      setEtapaAbierta({
        etiqueta,
        criterio: datos.criterio ?? "",
        leads: datos.leads ?? [],
        cargando: false,
      });
    } catch {
      toast.error("No se pudo traer la lista");
      setEtapaAbierta(null);
    }
  };

  const actualizar = (stage: string, campo: "goal" | "script", valor: string) => {
    setEtapas((actual) =>
      actual.map((etapa) => (etapa.stage === stage ? { ...etapa, [campo]: valor } : etapa)),
    );
  };

  // Alta y edicion en el mismo lugar: si el key ya esta en la lista se reemplaza, si no se suma
  // al final. El orden de la lista es el orden en que salen los mensajes.
  const guardarSeguimiento = (stage: string, seguimiento: SeguimientoDeEtapa) => {
    setEtapas((actual) =>
      actual.map((etapa) => {
        if (etapa.stage !== stage) {
          return etapa;
        }
        const existe = etapa.followUps.some((item) => item.key === seguimiento.key);
        return {
          ...etapa,
          followUps: existe
            ? etapa.followUps.map((item) => (item.key === seguimiento.key ? seguimiento : item))
            : [...etapa.followUps, seguimiento],
        };
      }),
    );
    setEditando(null);
  };

  const borrarSeguimiento = (stage: string, key: string) => {
    setEtapas((actual) =>
      actual.map((etapa) =>
        etapa.stage === stage
          ? { ...etapa, followUps: etapa.followUps.filter((item) => item.key !== key) }
          : etapa,
      ),
    );
  };

  const guardar = async () => {
    setOcupado(true);
    try {
      const result = await saveProductFunnelAction({
        productId,
        stages: etapas.map((etapa) => ({
          ...etapa,
          // El valor se escribe como texto (un input vacio no es un 0) y se manda como numero.
          followUps: etapa.followUps.map((seguimiento) => ({
            timeType: seguimiento.timeType,
            timeValue: Number(seguimiento.timeValue),
            content: seguimiento.content,
            cancelOnActivity: seguimiento.cancelOnActivity,
          })),
        })),
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setGuardado(JSON.stringify(etapas));
      toast.success("Embudo guardado");
      router.refresh();
    } catch {
      toast.error("No se pudo guardar. Recargá la página e intentá de nuevo.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-0">
        {/* Sin la linea de "5 de 5 escritas · se fueron aca...": cuantas etapas estan escritas se
            ve en la lista de abajo, y cuantos leads se fueron en cada una ya lo dice el numero
            naranja de cada etapa. Era el resumen de algo que esta a dos centimetros. */}
        <CardTitle className="text-sm">Embudo de ventas</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <Accordion defaultValue={abierta} keepMounted>
          {PRODUCT_FUNNEL_STAGES.map((meta, indice) => {
            const etapa = etapas.find((item) => item.stage === meta.stage);
            const resumen = etapa?.goal || etapa?.script || "";
            return (
              <AccordionItem key={meta.stage} value={meta.stage}>
                <AccordionTrigger className="py-3 hover:no-underline">
                  <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <span
                      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${
                        resumen
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {indice + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{meta.label}</span>
                        {/*
                          Cuantos se fueron SIN pasar de esta etapa. No sale de saber en que etapa
                          esta cada lead —eso lo dira la clasificacion— sino de cuantos mensajes
                          mando: si escribio una sola vez, es un hecho que no paso de la apertura.
                          Cierre queda sin numero a proposito: con este dato no se puede saber, y
                          poner uno inventado es exactamente lo que hacia el conteo anterior.
                        */}
                        {/*
                          El numero se puede ABRIR: un porcentaje que no se puede auditar es un
                          acto de fe. Va como span con rol de boton y no como <button> porque el
                          encabezado del acordeon YA es un boton, y un boton dentro de otro es
                          HTML invalido. El stopPropagation evita que al abrir la lista se abra
                          tambien la etapa.
                        */}
                        {perdidosEnEtapa[meta.stage] ? (
                          <span
                            role="button"
                            tabIndex={0}
                            title={`Ver los ${perdidosEnEtapa[meta.stage]?.valor} leads que no pasaron de "${meta.label}"`}
                            onClick={(evento) => {
                              evento.preventDefault();
                              evento.stopPropagation();
                              void abrirLeads(meta.stage, meta.label);
                            }}
                            onKeyDown={(evento) => {
                              if (evento.key !== "Enter" && evento.key !== " ") return;
                              evento.preventDefault();
                              evento.stopPropagation();
                              void abrirLeads(meta.stage, meta.label);
                            }}
                            className="shrink-0 cursor-pointer rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium leading-none text-amber-700 tabular-nums underline-offset-2 hover:underline dark:bg-amber-950 dark:text-amber-300"
                          >
                            {perdidosEnEtapa[meta.stage]?.valor} · {perdidosEnEtapa[meta.stage]?.pct}%
                          </span>
                        ) : null}
                        {/*
                          Que la etapa tiene seguimiento se ve CERRADA: si hay que abrir las cinco
                          para saber cuales avisan, nadie lo revisa.
                        */}
                        {etapa && etapa.followUps.length > 0 ? (
                          <span
                            title={`Si no contesta: ${etapa.followUps
                              .map((item) => `${item.timeValue} ${UNIDAD_CORTA[item.timeType]}`)
                              .join(" · ")}`}
                            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium leading-none text-sky-700 tabular-nums dark:bg-sky-950 dark:text-sky-300"
                          >
                            <Bell className="h-3 w-3" />
                            {etapa.followUps.length}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={`block truncate text-xs ${
                          resumen ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {resumen || "sin escribir"}
                      </span>
                    </span>
                  </span>
                </AccordionTrigger>

                <AccordionContent className="pb-4">
                  <div className="space-y-2">
                    <Label className="text-xs">Qué hay que lograr</Label>
                    <Input
                      value={etapa?.goal ?? ""}
                      onChange={(event) => actualizar(meta.stage, "goal", event.target.value)}
                      placeholder={meta.ayuda}
                    />
                    <Label className="text-xs">Qué decir</Label>
                    <Textarea
                      rows={3}
                      value={etapa?.script ?? ""}
                      onChange={(event) => actualizar(meta.stage, "script", event.target.value)}
                      placeholder="El mensaje, como se lo dirías vos…"
                    />

                    {/*
                      El seguimiento vive ACA, dentro de la etapa, y no en una regla suelta del
                      modulo Seguimientos: el mensaje correcto depende de donde se corto la charla.
                      No es lo mismo que se calle en la presentacion —ni sabemos que quiere— que en
                      el cierre, donde ya sabe el precio y lo esta pensando.

                      Lista + boton, y el formulario en un modal: aca solo se LEE la secuencia de
                      un vistazo. Los campos sueltos alargaban la etapa y en el celular el renglon
                      de los dias se partia en dos.
                    */}
                    <div className="mt-3 space-y-2 rounded-lg border border-dashed p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-xs">Si no contesta</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 text-xs"
                          onClick={() =>
                            setEditando({ stage: meta.stage, etiqueta: meta.label, seguimiento: null })
                          }
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Agregar seguimiento
                        </Button>
                      </div>

                      {/* Sin texto cuando no hay ninguno: la etapa vacia ya se ve vacia, y el
                          boton de arriba dice que se puede agregar. */}
                      {(etapa?.followUps.length ?? 0) === 0 ? null : (
                        <ul className="space-y-1">
                          {(etapa?.followUps ?? []).map((seguimiento, posicion) => (
                            <li
                              key={seguimiento.key}
                              className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5"
                            >
                              <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium leading-none text-sky-700 tabular-nums dark:bg-sky-950 dark:text-sky-300">
                                {seguimiento.timeValue} {UNIDAD_CORTA[seguimiento.timeType]}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                                {seguimiento.content}
                              </span>
                              <button
                                type="button"
                                title="Editar"
                                onClick={() =>
                                  setEditando({
                                    stage: meta.stage,
                                    etiqueta: meta.label,
                                    seguimiento,
                                  })
                                }
                                className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-background hover:text-foreground"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                title={`Quitar el seguimiento de ${seguimiento.timeValue} ${UNIDAD_CORTA[seguimiento.timeType]}`}
                                onClick={() => borrarSeguimiento(meta.stage, seguimiento.key)}
                                className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-background hover:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                              <span className="sr-only">Seguimiento {posicion + 1}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        <div className="flex items-center gap-3">
          <Button type="button" size="sm" onClick={() => void guardar()} disabled={ocupado}>
            Guardar embudo
          </Button>
          {hayCambios || vienenDelAgente ? (
            <span className="text-xs text-amber-700 dark:text-amber-300">Sin guardar</span>
          ) : escritas > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              Guardado
            </span>
          ) : null}
        </div>
      </CardContent>

      {/*
        Montado SOLO mientras se edita, en vez de estar siempre puesto con abierto=false.
        Medido en produccion: al cerrarlo quedaban en el DOM el fondo y la ventana con data-closed
        pero opacidad 1 y pointer-events auto, o sea una capa invisible sobre TODA la pantalla que
        se comia los clicks —incluido el de "Guardar embudo", que por eso no guardaba nada—. La
        salida del modal depende de que termine una animacion; desmontandolo no depende de nada.
      */}
      {editando ? (
        <StageFollowUpDialog
          abierto
          etapaLabel={editando.etiqueta}
          seguimiento={editando.seguimiento}
          onGuardar={(seguimiento) => guardarSeguimiento(editando.stage, seguimiento)}
          onCerrar={() => setEditando(null)}
        />
      ) : null}

      {/*
        La lista detras del numero. Cada fila dice CUANTOS mensajes mando ese cliente, que es el
        criterio con el que se lo agrupo: sin eso no se puede comprobar si el numero esta bien.
      */}
      <Dialog open={Boolean(etapaAbierta)} onOpenChange={(abierto) => !abierto && setEtapaAbierta(null)}>
        <DialogContent className="max-h-[85vh] overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="border-b p-4 text-left">
            <DialogTitle className="text-sm">
              Se quedaron en &quot;{etapaAbierta?.etiqueta}&quot;
            </DialogTitle>
            <DialogDescription className="text-xs">
              {etapaAbierta?.criterio
                ? `Últimos 30 días · el cliente mandó ${etapaAbierta.criterio}`
                : "Últimos 30 días"}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto p-2">
            {etapaAbierta?.cargando ? (
              <p className="p-4 text-center text-xs text-muted-foreground">Trayendo la lista…</p>
            ) : etapaAbierta?.leads.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted-foreground">
                No hay leads en esta etapa.
              </p>
            ) : (
              (etapaAbierta?.leads ?? []).map((lead) => (
                <Link
                  key={lead.conversationId}
                  href={lead.href}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-foreground">{lead.nombre}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {lead.telefono}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                    {lead.mensajes} {lead.mensajes === 1 ? "mensaje" : "mensajes"}
                  </span>
                </Link>
              ))
            )}
          </div>

          {(etapaAbierta?.leads.length ?? 0) >= 100 ? (
            <p className="border-t p-3 text-center text-[11px] text-muted-foreground">
              Se muestran los 100 más recientes.
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
