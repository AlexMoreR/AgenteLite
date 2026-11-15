import { prisma } from "@/lib/prisma";
import { leerConexionConGestion } from "@/lib/sincronizacion-gestion";
import {
  clienteDeGestion,
  filasDe,
  montoDeVentaPorCotizacion,
  type ClienteDeGestion,
} from "@/features/mejoras-vs-ventas/servicios/leer-gestion";

import {
  DIAS_MAXIMOS,
  armarCuerpo,
  armarEventoPurchase,
  cuentaComoEnviado,
  decidirEnvio,
  faltanLlaves,
  leerModo,
  montoValido,
  type EventoPurchase,
  type ModoConversiones,
} from "../dominio/evento-de-conversion";

/**
 * AVISO A META (API de Conversiones): por cada venta de pauta pagada en los últimos 7 días que vino de un chat
 * de anuncio (con ctwa_clid), le manda a Meta un evento "Purchase" con su monto.
 *
 * - La ÚNICA llamada a Meta es un POST a .../<META_CAPI_DATASET_ID>/events. No se lee ni se cambia nada más de Meta.
 * - Arranca APAGADO: se prende con el AppSetting `meta-conversiones:modo:<workspaceId>` = PRUEBA o ACTIVO.
 *   En PRUEBA hace falta `meta-conversiones:codigo-prueba:<workspaceId>` (los eventos salen en "Probar eventos").
 * - La llave va solo en el encabezado Authorization: nunca en la URL, en el log ni en lo que se guarda.
 * - El monto sale de la venta; si no está, del total de `listar_ventas` de Gestión (solo leer). Sin monto no se manda.
 */

const VERSION_GRAPH = "v21.0";
const ESPERA_MS = 30_000;
const EVENTO = "Purchase";
const LARGO_RESPUESTA = 200;

export const claveModoConversiones = (workspaceId: string) => `meta-conversiones:modo:${workspaceId}`;
export const claveCodigoPrueba = (workspaceId: string) => `meta-conversiones:codigo-prueba:${workspaceId}`;

export type MotivoConversiones = "APAGADO" | "FALTAN_LLAVES" | "SIN_CODIGO_PRUEBA" | "NADA_QUE_MANDAR";

export type ResultadoConversiones = {
  modo: ModoConversiones;
  mandados: number;
  errores: number;
  sinMonto: number;
  /** Ventas de pauta del chat sin ctwa_clid: Meta no las puede unir al anuncio. */
  sinClid: number;
  motivo?: MotivoConversiones;
  /** Solo los NOMBRES de las llaves que faltan, nunca sus valores. */
  faltan?: string[];
};

type BaseDeDatos = Pick<typeof prisma, "appSetting" | "ventaDePauta" | "origenDePauta" | "eventoDeConversion">;

export type DependenciasConversiones = {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  /** El cliente de Gestión (solo lectura). null = sin Gestión. Si no se pasa, se arma con la conexión del negocio. */
  gestion?: ClienteDeGestion | null;
  db?: BaseDeDatos;
};

const vacio = (modo: ModoConversiones, motivo: MotivoConversiones, extra: Partial<ResultadoConversiones> = {}): ResultadoConversiones => ({
  modo,
  mandados: 0,
  errores: 0,
  sinMonto: 0,
  sinClid: 0,
  motivo,
  ...extra,
});

/** Un mensaje corto de lo que respondió Meta, sin la llave aunque Meta la repitiera. */
function mensajeCorto(texto: string, llave: string): string {
  let mensaje = texto;
  try {
    const datos = JSON.parse(texto) as { error?: { message?: unknown; code?: unknown }; events_received?: unknown };
    if (datos?.error && typeof datos.error.message === "string") {
      mensaje = `${datos.error.code ?? ""} ${datos.error.message}`.trim();
    } else if (typeof datos?.events_received === "number") {
      mensaje = `events_received: ${datos.events_received}`;
    }
  } catch {
    // No era JSON: queda el texto tal cual, recortado.
  }
  return mensaje.split(llave).join("***").slice(0, LARGO_RESPUESTA);
}

export async function mandarConversionesDePauta(
  workspaceId: string,
  ahora = new Date(),
  deps: DependenciasConversiones = {},
): Promise<ResultadoConversiones> {
  const db = deps.db ?? prisma;
  const env = deps.env ?? process.env;

  const filaModo = await db.appSetting.findUnique({ where: { key: claveModoConversiones(workspaceId) } });
  const modo = leerModo(filaModo?.value);
  if (modo === "APAGADO") return vacio(modo, "APAGADO");

  const faltan = faltanLlaves(env);
  if (faltan.length) return vacio(modo, "FALTAN_LLAVES", { faltan });
  const llave = String(env.META_CAPI_ACCESS_TOKEN).trim();
  const datasetId = String(env.META_CAPI_DATASET_ID).trim();
  const wabaId = String(env.META_CAPI_WABA_ID).trim();

  let codigoPrueba: string | null = null;
  if (modo === "PRUEBA") {
    const filaCodigo = await db.appSetting.findUnique({ where: { key: claveCodigoPrueba(workspaceId) } });
    codigoPrueba = filaCodigo?.value?.trim() || null;
    if (!codigoPrueba) return vacio(modo, "SIN_CODIGO_PRUEBA");
  }

  const desde = new Date(ahora.getTime() - DIAS_MAXIMOS * 86_400_000);
  const ventas = await db.ventaDePauta.findMany({
    where: { workspaceId, categoria: "PAUTA", pagadaEn: { gte: desde, lte: ahora } },
    select: { id: true, cotizacion: true, monto: true, pagadaEn: true, categoria: true, origenDePautaId: true },
  });
  const idsDeOrigen = [...new Set(ventas.map((v) => v.origenDePautaId).filter((id): id is string => Boolean(id)))];
  const origenes = idsDeOrigen.length
    ? await db.origenDePauta.findMany({ where: { workspaceId, id: { in: idsDeOrigen } }, select: { id: true, ctwaClid: true } })
    : [];
  const clidDe = new Map(origenes.map((o) => [o.id, o.ctwaClid]));
  const previos = ventas.length
    ? await db.eventoDeConversion.findMany({
        where: { workspaceId, evento: EVENTO, modo, ventaDePautaId: { in: ventas.map((v) => v.id) } },
        select: { ventaDePautaId: true, estado: true, intentos: true },
      })
    : [];
  const previoDe = new Map(previos.map((p) => [p.ventaDePautaId, p]));

  // Las ventas de Gestión se leen una sola vez y solo si alguna venta no trae monto.
  let filasDeGestion: Promise<Record<string, unknown>[] | null> | null = null;
  const leerFilasDeGestion = () =>
    (filasDeGestion ??= (async () => {
      try {
        let cliente = deps.gestion;
        if (cliente === undefined) {
          const conexion = await leerConexionConGestion(workspaceId);
          cliente = conexion ? clienteDeGestion(conexion) : null;
        }
        if (!cliente) return null;
        const dia = (fecha: Date) => new Date(fecha.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
        return filasDe(await cliente.llamar("listar_ventas", { desde: dia(desde), hasta: dia(ahora), estado: "todas" }), "ventas");
      } catch (error) {
        console.error("[conversiones-meta] no se pudo leer el monto en Gestión", {
          workspaceId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    })());

  const clave = (ventaDePautaId: string) => ({
    workspaceId_ventaDePautaId_evento_modo: { workspaceId, ventaDePautaId, evento: EVENTO, modo },
  });

  const aMandar: Array<{ ventaDePautaId: string; valor: number; intentos: number; evento: EventoPurchase }> = [];
  let sinMonto = 0;
  let sinClid = 0;
  for (const venta of ventas) {
    const previo = previoDe.get(venta.id) ?? null;
    // Lo ya enviado no se toca (ni siquiera para marcarlo SIN_MONTO).
    if (cuentaComoEnviado(previo)) continue;
    const ctwaClid = venta.origenDePautaId ? (clidDe.get(venta.origenDePautaId) ?? null) : null;
    let monto: number | null = montoValido(venta.monto) ? venta.monto : null;
    if (monto === null && venta.cotizacion && ctwaClid?.trim()) {
      const filas = await leerFilasDeGestion();
      monto = filas ? montoDeVentaPorCotizacion(filas, venta.cotizacion) : null;
    }
    const decision = decidirEnvio({ venta, ctwaClid, monto, modo, yaEnviado: previo, ahora });
    if (decision.mandar && monto !== null && ctwaClid) {
      aMandar.push({
        ventaDePautaId: venta.id,
        valor: monto,
        intentos: previo?.intentos ?? 0,
        evento: armarEventoPurchase({ ventaDePautaId: venta.id, pagadaEn: venta.pagadaEn, valor: monto, ctwaClid, wabaId }),
      });
      continue;
    }
    if (decision.mandar) continue;
    if (decision.motivo === "SIN_CLID") sinClid += 1;
    if (decision.motivo === "SIN_MONTO") {
      sinMonto += 1;
      await db.eventoDeConversion.upsert({
        where: clave(venta.id),
        create: { workspaceId, ventaDePautaId: venta.id, evento: EVENTO, modo, estado: "SIN_MONTO" },
        update: { estado: "SIN_MONTO" },
      });
    }
  }

  if (!aMandar.length) return { modo, mandados: 0, errores: 0, sinMonto, sinClid, motivo: "NADA_QUE_MANDAR" };

  const cuerpo = armarCuerpo(
    aMandar.map((m) => m.evento),
    modo,
    codigoPrueba,
  );
  let ok = false;
  let respuesta = "";
  try {
    const enviar = deps.fetch ?? fetch;
    const res = await enviar(`https://graph.facebook.com/${VERSION_GRAPH}/${encodeURIComponent(datasetId)}/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${llave}`, "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      cache: "no-store",
      signal: AbortSignal.timeout(ESPERA_MS),
    });
    ok = res.ok;
    const texto = mensajeCorto(await res.text().catch(() => ""), llave);
    respuesta = (ok ? texto || `HTTP ${res.status}` : `HTTP ${res.status}: ${texto}`).slice(0, LARGO_RESPUESTA);
  } catch (error) {
    respuesta = mensajeCorto(error instanceof Error ? error.message : String(error), llave) || "No se pudo llamar a Meta.";
  }
  if (!ok) console.error("[conversiones-meta] Meta no aceptó los eventos", { workspaceId, modo, eventos: aMandar.length, respuesta });

  for (const m of aMandar) {
    const datos = ok
      ? { estado: "ENVIADO", valor: m.valor, intentos: m.intentos + 1, respuesta, enviadoEn: ahora }
      : { estado: "ERROR", valor: m.valor, intentos: m.intentos + 1, respuesta };
    await db.eventoDeConversion.upsert({
      where: clave(m.ventaDePautaId),
      create: { workspaceId, ventaDePautaId: m.ventaDePautaId, evento: EVENTO, modo, ...datos },
      update: datos,
    });
  }

  return { modo, mandados: ok ? aMandar.length : 0, errores: ok ? 0 : aMandar.length, sinMonto, sinClid };
}
