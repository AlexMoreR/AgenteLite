"use client";

import * as React from "react";
import Link from "next/link";
import { Flame, MessageCircle, TriangleAlert } from "lucide-react";
import { getCrmStageLabel } from "../domain/crm-config";
import type { CrmRecord, CrmStage } from "../types";

/**
 * "Se están enfriando" — los leads VIVOS a los que hace días que nadie les escribe.
 *
 * Es el agujero que no se veía en ningún lado. El informe contaba lo que entró y lo que se
 * vendió, pero nada mostraba lo que se está perdiendo por abandono: medido el 29-jul-2026, de
 * 7 leads en Caliente había 3 sin contacto hace más de 3 días y 2 hace más de una semana. Los
 * más caros del embudo, parados.
 *
 * NO repite la lista de "Mi día" (esa es para trabajar, lead por lead). Esta es la foto para el
 * dueño: cuánto se está enfriando y dónde duele más. La lista corta de abajo es solo el atajo a
 * los casos más caros.
 *
 * Se calcula sobre los registros que el informe ya tiene cargados: sin consultas nuevas.
 */

// Etapas del embudo activo. NUEVO queda afuera (todavía no engancharon, no hay nada que
// retomar) y GANADO/PERDIDO también (están cerrados).
const ETAPAS_VIVAS: CrmStage[] = ["NEGOCIACION", "PROPUESTA", "CALIFICADO"];

const UMBRALES = [3, 7, 15] as const;

function diasSin(record: CrmRecord, ahora: number) {
  return (ahora - new Date(record.date).getTime()) / (1000 * 60 * 60 * 24);
}

export function CrmFugaPanel({ records, generatedAt }: { records: CrmRecord[]; generatedAt: string }) {
  const { filas, criticos, totalEnRiesgo } = React.useMemo(() => {
    const ahora = new Date(generatedAt).getTime();

    const filas = ETAPAS_VIVAS.map((stage) => {
      const delEtapa = records.filter((record) => record.status === stage);
      const conteos = UMBRALES.map((dias) => delEtapa.filter((record) => diasSin(record, ahora) >= dias).length);
      return { stage, total: delEtapa.length, conteos };
    });

    // Los más caros primero (Caliente antes que Tibio) y, dentro de cada uno, los más parados.
    const criticos = records
      .filter((record) => ETAPAS_VIVAS.includes(record.status) && diasSin(record, ahora) >= 3)
      .map((record) => ({ record, dias: Math.floor(diasSin(record, ahora)) }))
      .sort((a, b) => {
        const prioridad = ETAPAS_VIVAS.indexOf(a.record.status) - ETAPAS_VIVAS.indexOf(b.record.status);
        return prioridad !== 0 ? prioridad : b.dias - a.dias;
      })
      .slice(0, 8);

    const totalEnRiesgo = filas.reduce((acc, fila) => acc + fila.conteos[0], 0);

    return { filas, criticos, totalEnRiesgo };
  }, [records, generatedAt]);

  if (totalEnRiesgo === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-3 text-[13px] text-muted-foreground">
        Ningún lead del embudo lleva más de 3 días sin contacto. Al día.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <span className="inline-flex items-center gap-2 text-[13px] font-medium text-foreground">
          <TriangleAlert className="h-3.5 w-3.5 text-amber-600" />
          Se están enfriando
        </span>
        <span className="text-[12px] text-muted-foreground">
          <span className="font-semibold text-foreground">{totalEnRiesgo}</span> leads vivos sin contacto hace 3 días o más
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[380px] border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-muted-foreground">
              <th className="px-3 py-2 font-medium">Etapa</th>
              <th className="px-3 py-2 font-medium">Vivos</th>
              {UMBRALES.map((dias) => (
                <th key={dias} className="px-3 py-2 text-right font-medium tabular-nums">
                  +{dias}d
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => (
              <tr key={fila.stage} className="border-t border-border">
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    {fila.stage === "NEGOCIACION" ? <Flame className="h-3.5 w-3.5 text-rose-500" /> : null}
                    {getCrmStageLabel(fila.stage)}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{fila.total}</td>
                {fila.conteos.map((valor, indice) => (
                  <td
                    key={UMBRALES[indice]}
                    className={`px-3 py-2 text-right tabular-nums ${
                      valor === 0
                        ? "text-muted-foreground"
                        : fila.stage === "NEGOCIACION"
                          ? "font-semibold text-rose-600"
                          : "font-medium text-amber-700"
                    }`}
                  >
                    {valor}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {criticos.length > 0 ? (
        <div className="border-t border-border">
          <p className="px-3 pt-2.5 text-[12px] text-muted-foreground">
            Los más caros parados. Tocá para abrir el chat y escribirle.
          </p>
          <ul className="divide-y divide-border">
            {criticos.map(({ record, dias }) => {
              const contenido = (
                <>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-foreground">{record.name || record.number}</span>
                    <span className="text-[12px] text-muted-foreground">
                      {getCrmStageLabel(record.status)} · {dias === 1 ? "1 día" : `${dias} días`} sin contacto
                    </span>
                  </span>
                  <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                </>
              );

              return (
                <li key={record.id}>
                  {record.chatKey ? (
                    <Link
                      href={`/cliente/chats?chatKey=${encodeURIComponent(record.chatKey)}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 transition hover:bg-muted"
                    >
                      {contenido}
                    </Link>
                  ) : (
                    <span className="flex items-center justify-between gap-3 px-3 py-2 opacity-70">{contenido}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
