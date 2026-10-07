import { prisma } from "@/lib/prisma";
import {
  armarOrigenDeVenta,
  mismaLlave,
  parsearMapaDeLineas,
  type DetalleDeOrigen,
  type LineaDelChat,
  type MapaDeLineas,
  type OrigenCalculado,
} from "@/lib/origen-de-venta";
import { leerConexionConGestion, negociosConGestion } from "@/lib/sincronizacion-gestion";

/**
 * ORIGEN DE LA VENTA → GESTIÓN (lo que toca la base). Las reglas están en origen-de-venta.ts.
 *
 * Al marcar GANADO con cotización, el CRM le avisa a Gestión "la COT-xxx vino de tal origen"
 * (POST /api/ventas/origen, misma conexión y llave que el catálogo y los envíos). Gestión lo guarda
 * en la cotización y lo copia a la venta. Las asesoras no escriben nada nuevo.
 *
 * Best-effort: se llama desde un after() y NUNCA lanza. Si Gestión no responde se reintenta un par
 * de veces y se deja en el log; el cambio de etapa ya quedó guardado y no depende de esto.
 *
 * Apagado de emergencia sin desplegar: variable ORIGEN_VENTAS_AVISO=off.
 */

const CLAVE_MAPA = "origen-ventas:lineas:";
const ESPERAS_MS = [0, 2_000, 6_000];

export async function leerMapaDeLineas(workspaceId: string): Promise<MapaDeLineas> {
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE_MAPA}${workspaceId}` } });
    return parsearMapaDeLineas(fila?.value);
  } catch {
    return {};
  }
}

/**
 * La línea del chat que trajo al cliente: la de su PRIMERA conversación (primer toque), sea por
 * Evolution/WAHA o por la API oficial. Si después siguió por Admin, igual cuenta por dónde llegó.
 */
async function lineaDelPrimerChat(workspaceId: string, contactId: string): Promise<LineaDelChat | null> {
  const [porEvolution, porOficial] = await Promise.all([
    prisma.conversation.findFirst({
      where: { workspaceId, contactId, channelId: { not: null } },
      orderBy: { startedAt: "asc" },
      select: {
        startedAt: true,
        channel: { select: { id: true, name: true, purpose: true, metadata: true } },
      },
    }),
    prisma.officialApiConversation.findFirst({
      where: { contact: { crmContactId: contactId, config: { workspaceId } } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  const oficialPrimero =
    porOficial && (!porEvolution || porOficial.createdAt.getTime() < porEvolution.startedAt.getTime());
  if (oficialPrimero) {
    // La API oficial no guarda la línea en el chat: es el canal OFFICIAL_API del negocio.
    const canal = await prisma.whatsAppChannel.findFirst({
      where: { workspaceId, provider: "OFFICIAL_API" },
      select: { id: true, name: true, purpose: true, metadata: true },
    });
    return canal
      ? { channelId: canal.id, nombre: canal.name, purpose: canal.purpose, metadata: canal.metadata }
      : { channelId: null, nombre: null };
  }
  const canal = porEvolution?.channel;
  return canal ? { channelId: canal.id, nombre: canal.name, purpose: canal.purpose, metadata: canal.metadata } : null;
}

/** El origen de un contacto del CRM, con la regla de la línea. */
export async function origenDelContacto(
  workspaceId: string,
  contactId: string,
  via: DetalleDeOrigen["via"] = "cotizacion",
): Promise<OrigenCalculado & { telefono: string | null }> {
  const [contacto, linea, mapa] = await Promise.all([
    prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { metadata: true, phoneNumber: true } }),
    lineaDelPrimerChat(workspaceId, contactId),
    leerMapaDeLineas(workspaceId),
  ]);
  const calculado = armarOrigenDeVenta({ linea, metadataContacto: contacto?.metadata, mapa, contactId, via });
  const digitos = contacto?.phoneNumber?.replace(/\D/g, "") ?? "";
  // Los contactos LID (sin número real) traen ids de 15+ dígitos: no sirven para cruzar.
  return { ...calculado, telefono: digitos.length >= 7 && digitos.length <= 13 ? digitos : null };
}

/** Busca la ficha por teléfono (para el relleno de ventas viejas desde Gestión). */
export async function origenPorTelefono(workspaceId: string, variantes: string[]): Promise<OrigenCalculado | null> {
  const contactos = await prisma.contact.findMany({
    where: { workspaceId, phoneNumber: { in: variantes } },
    select: { id: true, crmStage: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (!contactos.length) return null;
  // Si el mismo cliente quedó en dos fichas (57… y sin 57), manda la que se ganó.
  const elegido = contactos.find((c) => c.crmStage === "GANADO") ?? contactos[0];
  const origen = await origenDelContacto(workspaceId, elegido.id, "telefono");
  // El teléfono no sale de aquí: quien pregunta ya lo tiene.
  return { origin: origen.origin, originDetail: origen.originDetail, linea: origen.linea };
}

/** ¿Qué negocio tiene configurada esta llave de Gestión? (la llave es compartida entre los dos). */
export async function workspacePorLlaveDeGestion(llave: string): Promise<string | null> {
  for (const workspaceId of await negociosConGestion()) {
    const conexion = await leerConexionConGestion(workspaceId);
    if (conexion?.llave && mismaLlave(conexion.llave, llave)) return workspaceId;
  }
  return null;
}

function esperar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Avisa a Gestión el origen de la cotización ganada. Nunca lanza.
 * 404 con `cotizacion_no_existe` = la asesora escribió una cotización que Gestión no tiene: no se
 * reintenta (queda en el log para corregirla).
 */
export async function avisarOrigenAGestion(input: {
  workspaceId: string;
  contactId: string;
  quoteCode: string;
}): Promise<{ ok: boolean; status?: number; error?: string }> {
  if ((process.env.ORIGEN_VENTAS_AVISO ?? "").trim().toLowerCase() === "off") {
    return { ok: false, error: "apagado" };
  }
  try {
    const conexion = await leerConexionConGestion(input.workspaceId);
    if (!conexion) return { ok: false, error: "sin_conexion" };
    const url = new URL("/api/ventas/origen", new URL(conexion.url).origin);

    const origen = await origenDelContacto(input.workspaceId, input.contactId);
    const cuerpo = JSON.stringify({
      quoteCode: input.quoteCode,
      origin: origen.origin,
      originDetail: origen.originDetail,
      linea: origen.linea,
      // Solo para que Gestión decida "recurrente" si la cotización no tiene cliente; no se guarda.
      contactPhone: origen.telefono,
    });

    let ultimo: { ok: boolean; status?: number; error?: string } = { ok: false, error: "sin_intentos" };
    for (const espera of ESPERAS_MS) {
      if (espera) await esperar(espera);
      try {
        const respuesta = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${conexion.llave}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: cuerpo,
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        if (respuesta.ok) {
          console.log("[origen-ventas] avisado", {
            contactId: input.contactId,
            quoteCode: input.quoteCode,
            origin: origen.origin,
          });
          return { ok: true, status: respuesta.status };
        }
        ultimo = { ok: false, status: respuesta.status };
        // 4xx: reintentar no lo arregla (cotización inexistente, datos o llave inválidos).
        if (respuesta.status >= 400 && respuesta.status < 500) break;
      } catch (error) {
        ultimo = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    console.warn("[origen-ventas] aviso_fallido", {
      contactId: input.contactId,
      quoteCode: input.quoteCode,
      ...ultimo,
    });
    return ultimo;
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    console.warn("[origen-ventas] aviso_fallido", { contactId: input.contactId, quoteCode: input.quoteCode, error: mensaje });
    return { ok: false, error: mensaje };
  }
}
