/**
 * Rango de dias de los filtros del CRM (Registro y Kanban).
 *
 * Por defecto es "Esta semana" (desde el lunes, hora de Bogota) y no "1 Dia": el lunes a primera
 * hora "1 Dia" dejaba la pantalla casi vacia, y lo que el equipo revisa es la semana en curso.
 */
export type CrmDateRange = "semana" | "1" | "7" | "15" | "30" | "__all__";

export const CRM_DATE_RANGE_DEFAULT: CrmDateRange = "semana";

export const CRM_DATE_RANGE_OPTIONS: Array<{ value: CrmDateRange; label: string }> = [
  { value: "semana", label: "Esta semana" },
  { value: "1", label: "1 Dia" },
  { value: "7", label: "7 Dias" },
  { value: "15", label: "15 Dias" },
  { value: "30", label: "30 Dias" },
  { value: "__all__", label: "Todos" },
];

export function getCrmDateRangeLabel(value: string) {
  return CRM_DATE_RANGE_OPTIONS.find((option) => option.value === value)?.label ?? "Todos";
}

const DESFASE_BOGOTA_MS = 5 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Lunes 00:00 de la semana de `referencia`, en hora de Bogota (UTC-5, sin horario de verano). */
function inicioDeSemanaBogota(referencia: number) {
  const local = new Date(referencia - DESFASE_BOGOTA_MS);
  const diasDesdeLunes = (local.getUTCDay() + 6) % 7;
  return (
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - diasDesdeLunes) +
    DESFASE_BOGOTA_MS
  );
}

export function isInCrmDateRange(dateIso: string, range: CrmDateRange, referenceNow: string) {
  if (range === "__all__") {
    return true;
  }
  const fecha = new Date(dateIso).getTime();
  const ahora = new Date(referenceNow).getTime();
  if (range === "semana") {
    return fecha >= inicioDeSemanaBogota(ahora);
  }
  return (ahora - fecha) / DIA_MS <= Number(range);
}
