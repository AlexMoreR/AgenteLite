"use client";

import { useEffect, useState } from "react";
import { ArrowUp, Plus, X } from "lucide-react";

import { vistaPreviaAction } from "@/app/actions/automatizaciones-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  CAMPOS_DE_CONDICION,
  ETAPAS,
  ETAPAS_DESTINO,
  OPERADORES,
  SIN_ASIGNAR,
  TIPOS_DE_ACCION,
  accionVacia,
  condicionVacia,
  tieneEnvios,
  type Accion,
  type BorradorDeAutomatizacion,
  type CampoDeCondicion,
  type Condicion,
  type Etapa,
  type TipoDeAccion,
} from "@/features/automatizaciones/tipos";
import { CRM_LOST_REASONS, getCrmStageMeta } from "@/features/crm/domain/crm-config";

export type Opcion = { id: string; nombre: string };
export type Catalogos = { miembros: Opcion[]; canales: Opcion[]; etiquetas: Opcion[]; flujos: Opcion[] };

const MOTIVOS_DE_PERDIDA = CRM_LOST_REASONS.filter((motivo) => motivo.value !== "otro");

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition ${
        activo ? "border-[var(--primary)] bg-[var(--primary)]/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function alternar<T>(lista: T[], valor: T): T[] {
  return lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor];
}

/* ------------------------------------------------------------------------------------------------
   UNA CONDICIÓN: campo ▾ | operador ▾ | valor | ×
------------------------------------------------------------------------------------------------ */

function FilaDeCondicion({
  condicion,
  catalogos,
  onCambio,
  onQuitar,
}: {
  condicion: Condicion;
  catalogos: Catalogos;
  onCambio: (c: Condicion) => void;
  onQuitar: () => void;
}) {
  const operadores = OPERADORES[condicion.campo];
  const conValores = (opciones: Opcion[], valores: string[], cambiar: (v: string[]) => void) => (
    <div className="flex flex-wrap gap-1.5">
      {opciones.length === 0 ? <span className="text-[12px] text-muted-foreground">No hay opciones</span> : null}
      {opciones.map((opcion) => (
        <Chip key={opcion.id} activo={valores.includes(opcion.id)} onClick={() => cambiar(alternar(valores, opcion.id))}>
          {opcion.nombre}
        </Chip>
      ))}
    </div>
  );

  let valor: React.ReactNode = null;
  switch (condicion.campo) {
    case "etapa":
      valor = (
        <div className="flex flex-wrap gap-1.5">
          {ETAPAS.map((etapa) => (
            <Chip key={etapa} activo={condicion.valores.includes(etapa)} onClick={() => onCambio({ ...condicion, valores: alternar(condicion.valores, etapa) })}>
              {getCrmStageMeta(etapa).label}
            </Chip>
          ))}
        </div>
      );
      break;
    case "asignado":
      valor = conValores([{ id: SIN_ASIGNAR, nombre: "Sin asignar" }, ...catalogos.miembros], condicion.valores, (valores) => onCambio({ ...condicion, valores }));
      break;
    case "etiquetas":
      valor = conValores(catalogos.etiquetas, condicion.valores, (valores) => onCambio({ ...condicion, valores }));
      break;
    case "canal":
      valor = conValores(catalogos.canales, condicion.valores, (valores) => onCambio({ ...condicion, valores }));
      break;
    case "dias_sin_responder":
    case "dias_sin_mensajes":
      valor = (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            className="w-20"
            value={condicion.dias || ""}
            onChange={(evento) => onCambio({ ...condicion, dias: Number(evento.target.value) || 0 })}
          />
          <span className="text-[12px] text-muted-foreground">días</span>
        </div>
      );
      break;
    case "recuperacion_vencida":
      valor = <span className="text-[12px] text-muted-foreground">Tarea de llamada 72 h vencida (la de la alarma)</span>;
      break;
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-2.5">
      <div className="flex items-center gap-2">
        <NativeSelect
          className="min-w-0 flex-1"
          value={condicion.campo}
          onChange={(evento) => onCambio(condicionVacia(evento.target.value as CampoDeCondicion))}
        >
          {CAMPOS_DE_CONDICION.map((campo) => (
            <NativeSelectOption key={campo.campo} value={campo.campo}>
              {campo.etiqueta}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          className="w-28 shrink-0"
          value={condicion.operador}
          onChange={(evento) => onCambio({ ...condicion, operador: evento.target.value } as Condicion)}
        >
          {operadores.map((op) => (
            <NativeSelectOption key={op.valor} value={op.valor}>
              {op.etiqueta}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button variant="ghost" size="icon-sm" aria-label="Quitar condición" onClick={onQuitar}>
          <X className="size-4" />
        </Button>
      </div>
      {valor}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
   UNA ACCIÓN: acción ▾ | valor | ↑ ×
------------------------------------------------------------------------------------------------ */

function FilaDeAccion({
  accion,
  numero,
  catalogos,
  onCambio,
  onSubir,
  onQuitar,
}: {
  accion: Accion;
  numero: number;
  catalogos: Catalogos;
  onCambio: (a: Accion) => void;
  onSubir: (() => void) | null;
  onQuitar: () => void;
}) {
  const elegir = (opciones: Opcion[], valor: string, cambiar: (id: string) => void, vacio: string) => (
    <NativeSelect value={valor} onChange={(evento) => cambiar(evento.target.value)}>
      <NativeSelectOption value="">{vacio}</NativeSelectOption>
      {opciones.map((opcion) => (
        <NativeSelectOption key={opcion.id} value={opcion.id}>
          {opcion.nombre}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );

  let valor: React.ReactNode = null;
  switch (accion.tipo) {
    case "asignar":
      valor = elegir(catalogos.miembros, accion.usuarioId, (usuarioId) => onCambio({ ...accion, usuarioId }), "Elige una persona");
      break;
    case "anadir_etiqueta":
    case "quitar_etiqueta":
      valor = elegir(catalogos.etiquetas, accion.etiquetaId, (etiquetaId) => onCambio({ ...accion, etiquetaId }), "Elige una etiqueta");
      break;
    case "posponer":
      valor = (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            className="w-20"
            value={accion.dias ?? ""}
            onChange={(evento) => onCambio({ ...accion, dias: Number(evento.target.value) || null, hasta: null })}
          />
          <span className="text-[12px] text-muted-foreground">días (sale de Mi día)</span>
        </div>
      );
      break;
    case "enviar_flujo":
      valor = elegir(
        catalogos.flujos,
        accion.flujoId,
        (flujoId) => onCambio({ ...accion, flujoId, flujoNombre: catalogos.flujos.find((f) => f.id === flujoId)?.nombre ?? "" }),
        "Elige un flujo",
      );
      break;
    case "enviar_texto":
    case "nota":
      valor = (
        <Textarea
          rows={3}
          value={accion.texto}
          maxLength={1000}
          placeholder={accion.tipo === "nota" ? "Nota interna (no le llega al cliente)" : "Mensaje para el cliente"}
          onChange={(evento) => onCambio({ ...accion, texto: evento.target.value })}
        />
      );
      break;
    case "cambiar_etapa":
      valor = (
        <div className="space-y-2">
          <NativeSelect
            value={accion.etapa}
            onChange={(evento) => {
              const etapa = evento.target.value as Etapa;
              onCambio({ ...accion, etapa, motivoPerdida: etapa === "PERDIDO" ? accion.motivoPerdida ?? "sin_respuesta" : null });
            }}
          >
            {ETAPAS_DESTINO.map((etapa) => (
              <NativeSelectOption key={etapa} value={etapa}>
                {getCrmStageMeta(etapa).label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {accion.etapa === "PERDIDO" ? (
            <NativeSelect value={accion.motivoPerdida ?? ""} onChange={(evento) => onCambio({ ...accion, motivoPerdida: evento.target.value || null })}>
              {MOTIVOS_DE_PERDIDA.map((motivo) => (
                <NativeSelectOption key={motivo.value} value={motivo.value}>
                  Motivo: {motivo.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : null}
        </div>
      );
      break;
    case "resolver":
    case "abrir":
      valor = null;
      break;
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-2.5">
      <div className="flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
          {numero}
        </span>
        <NativeSelect
          className="min-w-0 flex-1"
          value={accion.tipo}
          onChange={(evento) => onCambio(accionVacia(evento.target.value as TipoDeAccion))}
        >
          {TIPOS_DE_ACCION.map((tipo) => (
            <NativeSelectOption key={tipo.tipo} value={tipo.tipo}>
              {tipo.etiqueta}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {onSubir ? (
          <Button variant="ghost" size="icon-sm" aria-label="Subir" onClick={onSubir}>
            <ArrowUp className="size-4" />
          </Button>
        ) : null}
        <Button variant="ghost" size="icon-sm" aria-label="Quitar acción" onClick={onQuitar}>
          <X className="size-4" />
        </Button>
      </div>
      {valor}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
   EL EDITOR
------------------------------------------------------------------------------------------------ */

type Previa = { total: number; tomaria: number; noLoVeria: number } | null;

export function EditorDeAutomatizacion({
  borrador,
  catalogos,
  onCambio,
}: {
  borrador: BorradorDeAutomatizacion;
  catalogos: Catalogos;
  onCambio: (b: BorradorDeAutomatizacion) => void;
}) {
  const [previa, setPrevia] = useState<Previa>(null);

  /*
    El número se actualiza MIENTRAS se arma la automatización: antes de guardar ya se ve "va a
    tomar 143 leads", y si eran 3 los que se esperaban, se nota que falta una condición.
  */
  useEffect(() => {
    const temporizador = window.setTimeout(() => {
      void vistaPreviaAction({ borrador }).then((respuesta) => setPrevia("error" in respuesta ? null : respuesta.conteo));
    }, 400);
    return () => window.clearTimeout(temporizador);
  }, [borrador]);

  const cambiarCondicion = (i: number, c: Condicion) => onCambio({ ...borrador, condiciones: borrador.condiciones.map((x, j) => (j === i ? c : x)) });
  const cambiarAccion = (i: number, a: Accion) => onCambio({ ...borrador, acciones: borrador.acciones.map((x, j) => (j === i ? a : x)) });
  const subirAccion = (i: number) => {
    const acciones = [...borrador.acciones];
    [acciones[i - 1], acciones[i]] = [acciones[i], acciones[i - 1]];
    onCambio({ ...borrador, acciones });
  };
  const conEnvios = tieneEnvios(borrador.acciones);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Label>Nombre</Label>
        <Input value={borrador.nombre} maxLength={60} onChange={(evento) => onCambio({ ...borrador, nombre: evento.target.value })} placeholder="Ej. Recuperación de María" />
      </div>

      <section className="space-y-2">
        <div>
          <p className="text-[13px] font-semibold text-foreground">Condiciones</p>
          <p className="text-[11px] text-muted-foreground">Tienen que cumplirse todas.</p>
        </div>
        {borrador.condiciones.map((condicion, i) => (
          <FilaDeCondicion
            key={i}
            condicion={condicion}
            catalogos={catalogos}
            onCambio={(c) => cambiarCondicion(i, c)}
            onQuitar={() => onCambio({ ...borrador, condiciones: borrador.condiciones.filter((_, j) => j !== i) })}
          />
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCambio({ ...borrador, condiciones: [...borrador.condiciones, condicionVacia("etapa")] })}
        >
          <Plus className="size-4" /> Añadir condición
        </Button>
        <div className="grid gap-3 pt-1 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-[13px] text-foreground">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={borrador.soloAbiertas}
              onChange={(evento) => onCambio({ ...borrador, soloAbiertas: evento.target.checked })}
            />
            Solo chats abiertos
          </label>
          <div className="flex items-center gap-2">
            <Label className="shrink-0 text-[13px]">Cantidad máxima</Label>
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              className="w-24"
              value={borrador.cantidad ?? ""}
              onChange={(evento) => onCambio({ ...borrador, cantidad: evento.target.value ? Number(evento.target.value) : null })}
              placeholder="Todos"
            />
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <div>
          <p className="text-[13px] font-semibold text-foreground">Acciones</p>
          <p className="text-[11px] text-muted-foreground">Se hacen en este orden.</p>
        </div>
        {borrador.acciones.map((accion, i) => (
          <FilaDeAccion
            key={i}
            numero={i + 1}
            accion={accion}
            catalogos={catalogos}
            onCambio={(a) => cambiarAccion(i, a)}
            onSubir={i > 0 ? () => subirAccion(i) : null}
            onQuitar={() => onCambio({ ...borrador, acciones: borrador.acciones.filter((_, j) => j !== i) })}
          />
        ))}
        <Button variant="outline" size="sm" onClick={() => onCambio({ ...borrador, acciones: [...borrador.acciones, accionVacia("asignar")] })}>
          <Plus className="size-4" /> Añadir acción
        </Button>
      </section>

      {conEnvios ? (
        <section className="space-y-2 rounded-xl border border-border p-3">
          <p className="text-[13px] font-semibold text-foreground">Ritmo de envío</p>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-foreground">
            De a
            <Input
              type="number"
              min={1}
              max={50}
              inputMode="numeric"
              className="w-16"
              value={borrador.ritmo.tanda}
              onChange={(evento) => onCambio({ ...borrador, ritmo: { ...borrador.ritmo, tanda: Number(evento.target.value) || 1 } })}
            />
            leads cada
            <Input
              type="number"
              min={5}
              max={240}
              inputMode="numeric"
              className="w-16"
              value={borrador.ritmo.cadaMinutos}
              onChange={(evento) => onCambio({ ...borrador, ritmo: { ...borrador.ritmo, cadaMinutos: Number(evento.target.value) || 15 } })}
            />
            min
          </div>
          <p className="text-[11px] text-muted-foreground">
            Solo de 8:00 a 20:00, con el espaciado y el tope del anti-bloqueo. Nunca a Ganados, Descartados ni ocultos.
          </p>
        </section>
      ) : null}

      <label className="flex items-start justify-between gap-3 rounded-xl border border-border p-3">
        <span>
          <span className="block text-[13px] font-semibold text-foreground">Automática</span>
          <span className="block text-[11px] text-muted-foreground">Corre sola cada 30 min, solo con los leads que todavía no procesó.</span>
        </span>
        <Switch checked={borrador.automatica} onCheckedChange={(automatica) => onCambio({ ...borrador, automatica })} />
      </label>

      {previa ? (
        <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-[13px] text-foreground">
          Hoy cumplen <span className="font-semibold tabular-nums">{previa.total}</span>
          {previa.total > previa.tomaria ? ` (toma ${previa.tomaria})` : ""}.
          {previa.noLoVeria > 0 ? (
            <span className="block text-[12px] text-amber-700 dark:text-amber-300">
              {previa.noLoVeria} son de un canal donde la persona a asignar no es colaboradora.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
