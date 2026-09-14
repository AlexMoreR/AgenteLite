import { CRM_STAGE_ORDER } from "@/features/crm/domain/crm-config";
import type { CrmStage } from "@/features/crm/types";

/**
 * Una automatizacion de asignacion: "toma ESTOS leads, hasta TANTOS, y daselos a ESTA persona".
 *
 * Nace de un pedido de Alex (14-sep-2026): no habia forma de decir "todos los descartados a
 * Genesis" o "20 de los que llevan 3 dias quietos a Maria". Se hacia chat por chat.
 *
 * Se guarda en AppSetting como JSON (ver servicio.ts) y no en una tabla propia: son pocas por
 * negocio y una migracion en la base de PRODUCCION es un riesgo que esto no justifica.
 */

/** De quien son hoy los leads que se toman. */
export type DuenoActual = "sin_asignar" | "cualquiera" | `de:${string}`;

export type UltimaEjecucion = { fecha: string; asignados: number; por: string };

export type AutomatizacionDeAsignacion = {
  id: string;
  nombre: string;
  dueno: DuenoActual;
  /** Vacio = cualquier etapa. */
  etapas: CrmStage[];
  /** null = cualquier canal. */
  canalId: string | null;
  /** "Sin mensajes de nadie" hace al menos estos dias. null = no importa. */
  diasSinMensajes: number | null;
  soloAbiertas: boolean;
  /** Cuantos toma como maximo. null = todos. */
  cantidad: number | null;
  /** A quien se asignan. */
  asignarA: string;
  ultimaEjecucion: UltimaEjecucion | null;
};

/** Lo que manda el formulario: todo menos el historial, que lo escribe el servidor. */
export type BorradorDeAutomatizacion = Omit<AutomatizacionDeAsignacion, "id" | "ultimaEjecucion"> & {
  id?: string;
};

/** Para que el conteo no tarde ni la ejecucion escriba miles de filas de golpe. */
export const MAXIMO_POR_EJECUCION = 2000;

const LARGO_DEL_NOMBRE = 60;

function enteroPositivo(valor: unknown): number | null {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor) : NaN;
  if (!Number.isFinite(numero)) {
    return null;
  }
  const entero = Math.floor(numero);
  return entero > 0 ? entero : null;
}

/**
 * Deja una automatizacion en forma, venga de la base o del formulario.
 *
 * Todo lo desconocido se descarta en vez de romper: un valor viejo o mal escrito no puede dejar la
 * pantalla sin abrir. Devuelve null solo si falta lo imprescindible (nombre y a quien asignar).
 */
export function limpiarAutomatizacion(valor: unknown): Omit<AutomatizacionDeAsignacion, "id" | "ultimaEjecucion"> | null {
  if (!valor || typeof valor !== "object") {
    return null;
  }
  const crudo = valor as Record<string, unknown>;
  const nombre = typeof crudo.nombre === "string" ? crudo.nombre.trim().slice(0, LARGO_DEL_NOMBRE) : "";
  const asignarA = typeof crudo.asignarA === "string" ? crudo.asignarA.trim() : "";
  if (!nombre || !asignarA) {
    return null;
  }

  const duenoCrudo = typeof crudo.dueno === "string" ? crudo.dueno : "";
  const dueno: DuenoActual =
    duenoCrudo === "sin_asignar" || duenoCrudo === "cualquiera"
      ? duenoCrudo
      : duenoCrudo.startsWith("de:") && duenoCrudo.length > 3
        ? (duenoCrudo as DuenoActual)
        : "sin_asignar";

  const etapas = Array.isArray(crudo.etapas)
    ? CRM_STAGE_ORDER.filter((etapa) => (crudo.etapas as unknown[]).includes(etapa))
    : [];

  return {
    nombre,
    dueno,
    etapas,
    canalId: typeof crudo.canalId === "string" && crudo.canalId.trim() ? crudo.canalId.trim() : null,
    diasSinMensajes: enteroPositivo(crudo.diasSinMensajes),
    soloAbiertas: crudo.soloAbiertas !== false,
    cantidad: enteroPositivo(crudo.cantidad),
    asignarA,
  };
}
