"use client";

import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { SelectorMultiple, type OpcionDeSelector } from "@/features/automatizaciones/components/SelectorConBusqueda";
import {
  CAMPOS_DEL_FILTRO,
  ETAPAS_CRM,
  MAX_CONDICIONES,
  OPCIONES_DE_ESTADO,
  OPERADORES_DEL_FILTRO,
  SIN_ASIGNAR,
  condicionVaciaDelFiltro,
  diasDeLaFecha,
  type CampoDeFecha,
  type CampoDelFiltro,
  type CondicionDelFiltro,
  type EstadoDeBandeja,
} from "@/features/chats/domain/filtros-de-bandeja";
import { CRM_STAGE_META } from "@/features/crm/domain/crm-config";

import type { CatalogosDeFiltro } from "./catalogos-de-filtro";

/*
  Las condiciones del filtro de la bandeja, con la MISMA fila que el editor de Automatizaciones
  (Alex, 16-10-2026): campo ▾ | operador ▾ | valor | ×. En el celular el valor baja a una segunda
  línea a lo ancho. Las cajas con buscador son las de Automatizaciones (SelectorConBusqueda).

  Estado (abiertas / resueltas / todas) es una fila más desde el 17-10-2026: antes eran botones
  arriba del modal. Se elige uno solo y hay a lo sumo una fila Estado.
*/

const OPCIONES_DE_ETAPA: OpcionDeSelector[] = ETAPAS_CRM.map((etapa) => ({ value: etapa, label: CRM_STAGE_META[etapa]?.label ?? etapa }));

function Dias({ valor, alCambiar, sufijo }: { valor: number | null | undefined; alCambiar: (dias: number) => void; sufijo: string }) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={1}
        inputMode="numeric"
        aria-label="Días"
        className="h-8 w-20"
        value={valor || ""}
        onChange={(evento) => alCambiar(Number(evento.target.value) || 0)}
      />
      <span className="text-[12px] text-muted-foreground">{sufijo}</span>
    </div>
  );
}

function FilaDeCondicion({
  condicion,
  catalogos,
  conEquipo,
  otraFilaDeEstado,
  onCambio,
  onQuitar,
}: {
  condicion: CondicionDelFiltro;
  catalogos: CatalogosDeFiltro;
  conEquipo: boolean;
  /** Ya hay OTRA fila Estado: esta no lo ofrece (dos estados juntos no tienen sentido). */
  otraFilaDeEstado: boolean;
  onCambio: (c: CondicionDelFiltro) => void;
  onQuitar: () => void;
}) {
  const operadores = OPERADORES_DEL_FILTRO[condicion.campo];
  const nombreDelCampo = CAMPOS_DEL_FILTRO.find((c) => c.campo === condicion.campo)?.etiqueta ?? "Valores";
  const multiple = (opciones: OpcionDeSelector[]) =>
    "valores" in condicion ? (
      <SelectorMultiple
        etiqueta={nombreDelCampo}
        opciones={opciones}
        valores={condicion.valores}
        alCambiar={(valores) => onCambio({ ...condicion, valores } as CondicionDelFiltro)}
      />
    ) : null;

  let valor: React.ReactNode = null;
  switch (condicion.campo) {
    case "estado":
      valor = (
        <NativeSelect
          aria-label="Estado"
          className="w-full sm:w-40"
          value={condicion.valor}
          onChange={(evento) => onCambio({ ...condicion, valor: evento.target.value as EstadoDeBandeja })}
        >
          {OPCIONES_DE_ESTADO.map((opcion) => (
            <NativeSelectOption key={opcion.valor} value={opcion.valor}>
              {opcion.etiqueta}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      );
      break;
    case "etapa":
      valor = multiple(OPCIONES_DE_ETAPA);
      break;
    case "etiquetas":
      valor = multiple(catalogos.etiquetas.map((e) => ({ value: e.id, label: e.name })));
      break;
    case "asesora":
      valor = multiple([{ value: SIN_ASIGNAR, label: "Sin asignar" }, ...catalogos.miembros.map((m) => ({ value: m.id, label: m.nombre }))]);
      break;
    case "canal":
      valor = multiple(catalogos.canales.map((c) => ({ value: c.id, label: c.nombre })));
      break;
    case "fecha": {
      const dias = diasDeLaFecha(condicion, new Date());
      valor = (
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label="Sobre qué fecha"
            className="w-40 shrink-0"
            value={condicion.sobre}
            onChange={(evento) => onCambio({ ...condicion, sobre: evento.target.value as CampoDeFecha })}
          >
            <NativeSelectOption value="ultimo">Último mensaje</NativeSelectOption>
            <NativeSelectOption value="llego">Llegó</NativeSelectOption>
          </NativeSelect>
          {condicion.operador === "ultimos" ? (
            <Dias valor={condicion.dias} alCambiar={(n) => onCambio({ ...condicion, dias: n })} sufijo="días (con hoy)" />
          ) : condicion.operador === "entre" ? (
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
              {/* Selector de fecha nativo: en el celular abre el calendario del teléfono. */}
              <Input
                type="date"
                aria-label="Desde"
                className="h-8 min-w-0"
                value={condicion.desde ?? ""}
                max={condicion.hasta ?? undefined}
                onChange={(evento) => onCambio({ ...condicion, desde: evento.target.value || null })}
              />
              <Input
                type="date"
                aria-label="Hasta"
                className="h-8 min-w-0"
                value={condicion.hasta ?? ""}
                min={condicion.desde ?? undefined}
                onChange={(evento) => onCambio({ ...condicion, hasta: evento.target.value || null })}
              />
            </div>
          ) : (
            <span className="text-[12px] text-muted-foreground">
              {dias.desde === dias.hasta ? dias.desde : `${dias.desde} a ${dias.hasta}`}
            </span>
          )}
        </div>
      );
      break;
    }
    case "sin_responder":
      valor = (
        <span className="flex min-h-8 items-center text-[12px] text-muted-foreground">
          {condicion.operador === "si" ? "Lo último lo escribió el cliente" : "Ya le contestamos"}
        </span>
      );
      break;
    case "dias_sin_responder":
      valor = <Dias valor={condicion.dias} alCambiar={(n) => onCambio({ ...condicion, dias: n })} sufijo="días sin que el cliente escriba" />;
      break;
  }

  // Sin equipo (la asesora no ve a las demás) la condición Asesora no se ofrece.
  // Y Estado no se ofrece si ya hay otra fila Estado.
  const campos = CAMPOS_DEL_FILTRO.filter(
    (c) =>
      c.campo === condicion.campo ||
      ((conEquipo || c.campo !== "asesora") && !(otraFilaDeEstado && c.campo === "estado")),
  );

  return (
    <div className="flex flex-wrap items-start gap-2 rounded-xl border border-border bg-muted/30 p-2.5">
      <NativeSelect
        aria-label="Campo"
        className="min-w-0 flex-1 sm:w-40 sm:flex-none"
        value={condicion.campo}
        onChange={(evento) => onCambio(condicionVaciaDelFiltro(evento.target.value as CampoDelFiltro))}
      >
        {campos.map((c) => (
          <NativeSelectOption key={c.campo} value={c.campo}>
            {c.etiqueta}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <NativeSelect
        aria-label="Operador"
        className="w-28 shrink-0"
        value={condicion.operador}
        onChange={(evento) => {
          const operador = evento.target.value;
          if (condicion.campo === "fecha") {
            // Al pasar a "entre" se parte de los días que mostraba el atajo (editables).
            const dias = diasDeLaFecha(condicion, new Date());
            onCambio(
              operador === "entre"
                ? { campo: "fecha", sobre: condicion.sobre, operador: "entre", desde: dias.desde, hasta: dias.hasta }
                : operador === "ultimos"
                  ? { campo: "fecha", sobre: condicion.sobre, operador: "ultimos", dias: condicion.dias || 7 }
                  : { campo: "fecha", sobre: condicion.sobre, operador: operador as "hoy" | "ayer" | "mes" },
            );
            return;
          }
          onCambio({ ...condicion, operador } as CondicionDelFiltro);
        }}
      >
        {operadores.map((op) => (
          <NativeSelectOption key={op.valor} value={op.valor}>
            {op.etiqueta}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <div className="order-last min-w-0 basis-full sm:order-none sm:basis-0 sm:flex-1">{valor}</div>
      <Button variant="ghost" size="icon-sm" aria-label="Quitar condición" onClick={onQuitar}>
        <X className="size-4" />
      </Button>
    </div>
  );
}

export function EditorDeCondicionesDeBandeja({
  condiciones,
  catalogos,
  conEquipo,
  onCambio,
}: {
  condiciones: CondicionDelFiltro[];
  catalogos: CatalogosDeFiltro;
  conEquipo: boolean;
  onCambio: (condiciones: CondicionDelFiltro[]) => void;
}) {
  return (
    <section className="space-y-2">
      <div>
        <p className="text-[13px] font-semibold text-foreground">Condiciones</p>
        <p className="text-[11px] text-muted-foreground">Tienen que cumplirse todas.</p>
      </div>
      {condiciones.map((condicion, i) => (
        <FilaDeCondicion
          key={i}
          condicion={condicion}
          catalogos={catalogos}
          conEquipo={conEquipo}
          otraFilaDeEstado={condiciones.some((x, j) => j !== i && x.campo === "estado")}
          onCambio={(c) => onCambio(condiciones.map((x, j) => (j === i ? c : x)))}
          onQuitar={() => onCambio(condiciones.filter((_, j) => j !== i))}
        />
      ))}
      {condiciones.length < MAX_CONDICIONES ? (
        <Button variant="outline" size="sm" onClick={() => onCambio([...condiciones, condicionVaciaDelFiltro("etiquetas")])}>
          <Plus className="size-4" /> Añadir condición
        </Button>
      ) : null}
    </section>
  );
}
