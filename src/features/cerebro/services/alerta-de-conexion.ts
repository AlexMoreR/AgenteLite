import { prisma } from "@/lib/prisma";
import type { Incidente } from "@/features/supervisor/dominio/alertas";
import type { Hallazgo } from "@/features/supervisor/dominio/tipos";
import { guardarIncidentes, leerIncidentesAbiertos } from "@/features/supervisor/servicios/almacen-alertas";

/*
  CEREBRO: alerta cuando se desconecta de Drive. Va a la página de alertas del Supervisor (prioridad
  "Alta" = IMPORTANTE) y NUNCA al WhatsApp ni al push: solo se guarda la alerta.
  Una sola alerta por negocio (`CEREBRO:desconectado`): se abre o se mantiene mientras la última
  sincronización falle o lleve demasiado sin hacerse, y se cierra cuando vuelve a sincronizar bien.
*/

export const CLAVE_CEREBRO_DESCONECTADO = "CEREBRO:desconectado";
/** Horas sin sincronizar para considerar el cerebro desconectado (la vuelta es cada hora). */
export const HORAS_SIN_SINCRONIZAR = 3;

export type ConexionParaAlerta = {
  workspaceId: string;
  carpetaId: string | null;
  ultimoError: string | null;
  ultimaSincronizacion: Date | null;
  creadoEn: Date;
};

/** El motivo de que esté desconectado, o null si está bien (o si todavía no se configuró). */
export function motivoDeDesconexion(conexion: ConexionParaAlerta, ahora: Date): string | null {
  if (!conexion.carpetaId) return null;
  if (conexion.ultimoError) return `La última sincronización falló: ${conexion.ultimoError.slice(0, 300)}`;
  const referencia = conexion.ultimaSincronizacion ?? conexion.creadoEn;
  const horas = (ahora.getTime() - referencia.getTime()) / 3_600_000;
  if (horas > HORAS_SIN_SINCRONIZAR) {
    return `Lleva más de ${HORAS_SIN_SINCRONIZAR} horas sin sincronizar (${Math.floor(horas)} h).`;
  }
  return null;
}

function hallazgoDeDesconexion(motivo: string, desde: Date): Hallazgo {
  return {
    clave: CLAVE_CEREBRO_DESCONECTADO,
    familia: "CEREBRO",
    severidad: "IMPORTANTE",
    titulo: "El cerebro no está conectado a Google Drive",
    que: motivo,
    desde,
    producto: null,
    leadsAfectados: 0,
    evidencia: { chats: [], reglas: [], versiones: [] },
    metrica: "Última sincronización del cerebro",
    esperado: `Sincroniza cada hora (máximo ${HORAS_SIN_SINCRONIZAR} h sin hacerlo) y sin error.`,
    observado: motivo,
    hechos: [motivo],
    hipotesis: ["Falló el acceso de la cuenta de servicio de Google, o la carpeta Empresa Magilus ya no está compartida con ese correo."],
    causaPosible: "La cuenta de servicio perdió acceso a la carpeta del cerebro, o Google no respondió.",
    impacto: "Las decisiones que se anotan y lo que se consulta del cerebro pueden no coincidir con el Drive.",
    recomendacion: "Revisar en Mi empresa → Cerebro el error, confirmar que la carpeta sigue compartida con la cuenta de servicio y sincronizar con el botón.",
    queCambiar: "Nada en el código: es la conexión con Drive.",
    riesgo: "Bajo: no se escribe a nadie; solo se pierde la sincronización hasta que se arregle.",
    comoMedir: "La alerta se cierra sola cuando el cerebro vuelve a sincronizar bien.",
    tocaProduccion: false,
  };
}

/**
 * Decide qué pasa con la alerta de un negocio (código puro). Devuelve el incidente a guardar, o null si no hay nada que hacer.
 * No avisa por push ni WhatsApp: no marca `notificadaEn`.
 */
export function incidenteDeConexion(conexion: ConexionParaAlerta, abierto: Incidente | undefined, ahora: Date): Incidente | null {
  const motivo = motivoDeDesconexion(conexion, ahora);
  if (motivo) {
    const hallazgo = hallazgoDeDesconexion(motivo, abierto?.desde ?? ahora);
    return {
      clave: CLAVE_CEREBRO_DESCONECTADO,
      familia: "CEREBRO",
      severidad: "IMPORTANTE",
      titulo: hallazgo.titulo,
      producto: null,
      primeraVezEn: abierto?.primeraVezEn ?? ahora,
      ultimaVezEn: ahora,
      desde: hallazgo.desde,
      vecesVista: (abierto?.vecesVista ?? 0) + 1,
      estado: "ABIERTA",
      resueltaEn: null,
      notificadaEn: abierto?.notificadaEn ?? null,
      severidadNotificada: abierto?.severidadNotificada ?? null,
      hallazgos: [hallazgo],
    };
  }
  if (!abierto) return null;
  return { ...abierto, estado: "RESUELTA", resueltaEn: ahora };
}

/** Lo que la alerta necesita de afuera (se cambia por falsos en las pruebas). */
export type DependenciasDeAlerta = {
  conexiones(): Promise<ConexionParaAlerta[]>;
  abiertos(workspaceId: string): Promise<Incidente[]>;
  guardar(workspaceId: string, incidentes: Incidente[], ahora: Date): Promise<number>;
};

export async function revisarAlertaDeConexionConDependencias(deps: DependenciasDeAlerta, ahora: Date = new Date()): Promise<number> {
  let cambios = 0;
  for (const conexion of await deps.conexiones()) {
    const abierto = (await deps.abiertos(conexion.workspaceId)).find((inc) => inc.clave === CLAVE_CEREBRO_DESCONECTADO);
    const incidente = incidenteDeConexion(conexion, abierto, ahora);
    if (!incidente) continue;
    cambios += await deps.guardar(conexion.workspaceId, [incidente], ahora);
  }
  return cambios;
}

/** Se llama cada hora (minuto 41), justo después de sincronizar el cerebro. */
export async function revisarAlertaDeConexion(): Promise<number> {
  return revisarAlertaDeConexionConDependencias({
    conexiones: () =>
      prisma.cerebroConexion.findMany({
        select: { workspaceId: true, carpetaId: true, ultimoError: true, ultimaSincronizacion: true, creadoEn: true },
      }),
    abiertos: leerIncidentesAbiertos,
    guardar: guardarIncidentes,
  });
}

