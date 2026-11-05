import { prisma } from "@/lib/prisma";
import { buscarAnuncio, listarAnunciosDeCampana, metaAdsConfigurado } from "@/features/pauta/servicios/meta-ads-lectura";
import { setConversationAutomationPaused } from "@/lib/conversation-automation";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { etapaAlAsignar } from "@/lib/etapa-automatica-crm";
import { avisarAsesorPorWhatsApp } from "@/features/agente-v3/servicios/avisos";
import { avisarAsignacionPorPush } from "@/lib/reparto-de-leads";

/**
 * REPARTO POR ANUNCIO (pedido del dueño, 3-nov-2026): cada chat nuevo que llega de un anuncio de Meta
 * (Click-to-WhatsApp) se le asigna a la asesora que diga la regla de ESE anuncio o de SU campaña, en
 * la misma línea. Primer uso: la campaña de salones completos y almacenes, directo a Yair.
 *
 * - Las reglas viven en AppSetting (`reparto-por-anuncio:reglas:<negocio>`), como la configuración de
 *   reparto que ya existe. Sin reglas, el webhook sigue exactamente igual que antes.
 * - La regla por ANUNCIO gana sobre la de CAMPAÑA.
 * - El mensaje de WhatsApp trae el anuncio, no la campaña: la campaña se busca en lo que el CRM ya sabe
 *   (OrigenDePauta, o el recuerdo `reparto-por-anuncio:campana:<anuncio>`) y, si no, se le pregunta a
 *   Meta con la función de SOLO LECTURA del informe de pauta, con un límite de 3 segundos.
 * - Para no depender de esa pregunta en cada chat, el CRM APRENDE de Meta (solo lectura) los anuncios
 *   de cada campaña con regla y los deja en ese mismo recuerdo: al guardar una regla de campaña, con el
 *   botón "Actualizar anuncios", y en segundo plano cuando llega un chat de una línea con reglas de
 *   campaña (como mucho una vez cada 15 minutos por negocio, con la marca
 *   `reparto-por-anuncio:campanas-actualizadas:<negocio>`).
 * - Nunca le saca un chat a nadie: si ya tiene dueña, no se toca.
 * - Si la asesora de la regla ya no está activa en el equipo, el chat sigue el reparto normal.
 * - No le escribe nada al cliente. Cuando la regla le pasa el chat a una asesora, el bot SIEMPRE queda
 *   en pausa en ese chat (desde el 5-nov-2026, para que el bot no le mande el combo a esos clientes).
 *   La casilla "Sin bienvenida" ya no decide la pausa: solo decide si en ese primer mensaje sale o no
 *   el acuse de pausa (lo usa el webhook). Las reglas de "reparto normal" no pausan nada.
 * - Cada chat que una regla asigna deja una marca en AppSetting
 *   (`reparto-por-anuncio:uso:<negocio>:<regla>:<chat>`) para contar cuántos chats tomó cada regla.
 * - Si una regla no se aplica, el registro dice por qué: sin llave de Meta, Meta no contestó a tiempo,
 *   Meta no conoce el anuncio, o la regla es de otra línea.
 */

export const TIPOS_DE_REGLA = ["campana", "anuncio"] as const;
export type TipoDeRegla = (typeof TIPOS_DE_REGLA)[number];

export type ReglaDeAnuncio = {
  id: string;
  tipo: TipoDeRegla;
  /** El número de Meta de la campaña o del anuncio. */
  metaId: string;
  /** Un nombre para reconocerla ("Salones y almacenes"). */
  nombre: string;
  /** La línea de WhatsApp donde aplica. */
  channelId: string;
  /** A quién va el chat. null = reparto normal. */
  asignarA: string | null;
  /** El bot no saluda: el chat queda en pausa para que conteste la asesora. */
  sinBienvenida: boolean;
  activa: boolean;
  creadaEn: string;
};

export const ESPERA_DE_META_MS = 3_000;
export const MAXIMO_DE_REGLAS = 100;
const MAXIMO_NOMBRE = 80;

export function claveDeReglas(workspaceId: string): string {
  return `reparto-por-anuncio:reglas:${workspaceId}`;
}

/** La marca de que la regla `reglaId` asignó el chat `conversationId` (una por chat: sirve de contador). */
export function claveDeUsoDeLaRegla(workspaceId: string, reglaId: string, conversationId: string): string {
  return `reparto-por-anuncio:uso:${workspaceId}:${reglaId}:${conversationId}`;
}

export type UsoDeLaRegla = { chats: number; ultimo: Date };

/**
 * Cuántos chats asignó cada regla y cuándo fue el último, por id de regla. Se lee de las marcas de
 * `claveDeUsoDeLaRegla` (un chat cuenta una sola vez aunque la regla se aplique dos veces).
 */
export async function usoDeLasReglas(workspaceId: string): Promise<Record<string, UsoDeLaRegla>> {
  const prefijo = `reparto-por-anuncio:uso:${workspaceId}:`;
  const filas = await prisma.appSetting.findMany({
    where: { key: { startsWith: prefijo } },
    select: { key: true, createdAt: true },
  });
  const uso: Record<string, UsoDeLaRegla> = {};
  for (const fila of filas) {
    const resto = fila.key.slice(prefijo.length);
    const separador = resto.indexOf(":");
    if (separador <= 0) continue;
    const reglaId = resto.slice(0, separador);
    const actual = uso[reglaId];
    if (!actual) uso[reglaId] = { chats: 1, ultimo: fila.createdAt };
    else {
      actual.chats += 1;
      if (fila.createdAt > actual.ultimo) actual.ultimo = fila.createdAt;
    }
  }
  return uso;
}

export function claveDeCampanaDelAnuncio(anuncioId: string): string {
  return `reparto-por-anuncio:campana:${anuncioId}`;
}

/** Un id de Meta válido: solo números, de 5 a 25 cifras (igual que pide `buscarAnuncio`). */
export function esIdDeMeta(valor: unknown): valor is string {
  return typeof valor === "string" && /^\d{5,25}$/.test(valor);
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** Lee las reglas guardadas. Lo roto o incompleto se descarta en silencio; nunca lanza. */
export function leerReglasDeTexto(valor: string | null | undefined): ReglaDeAnuncio[] {
  if (!valor) return [];
  let crudo: unknown;
  try {
    crudo = JSON.parse(valor);
  } catch {
    return [];
  }
  if (!Array.isArray(crudo)) return [];
  const reglas: ReglaDeAnuncio[] = [];
  for (const item of crudo) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    const tipo = texto(r.tipo);
    const metaId = texto(r.metaId);
    const channelId = texto(r.channelId);
    const id = texto(r.id);
    if (!id || !channelId || !esIdDeMeta(metaId) || !(TIPOS_DE_REGLA as readonly string[]).includes(tipo)) continue;
    const asignarA = texto(r.asignarA) || null;
    reglas.push({
      id,
      tipo: tipo as TipoDeRegla,
      metaId,
      nombre: texto(r.nombre).slice(0, MAXIMO_NOMBRE),
      channelId,
      asignarA,
      // "Sin bienvenida" solo tiene sentido si hay a quién pasarle el chat.
      sinBienvenida: asignarA !== null && r.sinBienvenida === true,
      activa: r.activa !== false,
      creadaEn: texto(r.creadaEn),
    });
  }
  return reglas;
}

/** ¿Hay alguna regla prendida en esa línea? Sin ninguna, el webhook no hace nada nuevo. */
export function hayReglasEnLaLinea(reglas: ReglaDeAnuncio[], channelId: string): boolean {
  return reglas.some((regla) => regla.activa && regla.channelId === channelId);
}

/** ¿Hay alguna regla de CAMPAÑA prendida en esa línea? Solo entonces vale la pena buscar la campaña. */
export function hayReglasDeCampanaEnLaLinea(reglas: ReglaDeAnuncio[], channelId: string): boolean {
  return reglas.some((regla) => regla.activa && regla.channelId === channelId && regla.tipo === "campana");
}

/**
 * La regla que le toca al chat (función pura). Solo reglas prendidas y de esa línea. La de anuncio
 * gana sobre la de campaña. null = ninguna regla: reparto normal.
 */
export function buscarReglaDelAnuncio(input: {
  reglas: ReglaDeAnuncio[];
  channelId: string;
  anuncioId: string | null;
  campanaId: string | null;
}): ReglaDeAnuncio | null {
  const candidatas = input.reglas.filter((regla) => regla.activa && regla.channelId === input.channelId);
  if (input.anuncioId) {
    const porAnuncio = candidatas.find((regla) => regla.tipo === "anuncio" && regla.metaId === input.anuncioId);
    if (porAnuncio) return porAnuncio;
  }
  if (input.campanaId) {
    const porCampana = candidatas.find((regla) => regla.tipo === "campana" && regla.metaId === input.campanaId);
    if (porCampana) return porCampana;
  }
  return null;
}

// ── Lectura y guardado ─────────────────────────────────────────────────────────────────────────

export async function leerReglas(workspaceId: string): Promise<ReglaDeAnuncio[]> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDeReglas(workspaceId) }, select: { value: true } });
  return leerReglasDeTexto(fila?.value);
}

export async function guardarReglas(workspaceId: string, reglas: ReglaDeAnuncio[]): Promise<void> {
  const clave = claveDeReglas(workspaceId);
  const valor = JSON.stringify(reglas.slice(0, MAXIMO_DE_REGLAS));
  await prisma.appSetting.upsert({ where: { key: clave }, create: { key: clave, value: valor }, update: { value: valor } });
}

// ── La campaña de un anuncio ───────────────────────────────────────────────────────────────────

export type CampanaDelAnuncio = { campanaId: string; campanaNombre: string | null; anuncioNombre: string | null };

function leerRecuerdo(valor: string | null | undefined): CampanaDelAnuncio | null {
  if (!valor) return null;
  try {
    const r = JSON.parse(valor) as Record<string, unknown>;
    const campanaId = texto(r.campanaId);
    if (!campanaId) return null;
    return { campanaId, campanaNombre: texto(r.campanaNombre) || null, anuncioNombre: texto(r.anuncioNombre) || null };
  } catch {
    return null;
  }
}

async function guardarRecuerdo(anuncioId: string, campana: CampanaDelAnuncio): Promise<void> {
  const clave = claveDeCampanaDelAnuncio(anuncioId);
  const valor = JSON.stringify(campana);
  await prisma.appSetting
    .upsert({ where: { key: clave }, create: { key: clave, value: valor }, update: { value: valor } })
    .catch(() => undefined);
}

/**
 * La campaña del anuncio: primero lo que el CRM ya sabe, si no Meta (solo lectura) con un límite.
 * Si Meta tarda más que el límite, se sigue sin campaña y, si contesta después, queda en el recuerdo
 * para el próximo chat. Nunca lanza.
 */
export async function campanaDelAnuncio(
  workspaceId: string,
  anuncioId: string,
  opciones: { esperaMs?: number } = {},
): Promise<CampanaDelAnuncio | null> {
  if (!esIdDeMeta(anuncioId)) return null;
  try {
    const [origen, recuerdo] = await Promise.all([
      prisma.origenDePauta.findFirst({
        where: { workspaceId, anuncioId, campanaId: { not: null } },
        select: { campanaId: true, campanaNombre: true, anuncioNombre: true },
      }),
      prisma.appSetting.findUnique({ where: { key: claveDeCampanaDelAnuncio(anuncioId) }, select: { value: true } }),
    ]);
    if (origen?.campanaId) {
      return { campanaId: origen.campanaId, campanaNombre: origen.campanaNombre, anuncioNombre: origen.anuncioNombre };
    }
    const recordado = leerRecuerdo(recuerdo?.value);
    if (recordado) return recordado;
  } catch (error) {
    console.warn("[reparto-por-anuncio] no se pudo leer la campaña guardada", {
      anuncioId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!metaAdsConfigurado()) {
    console.log("[reparto-por-anuncio] campaña desconocida: no hay llave de Meta (la regla por campaña no se aplica)", {
      anuncioId,
    });
    return null;
  }

  let contesto = false;
  const pregunta = buscarAnuncio(anuncioId)
    .then(async (datos) => {
      contesto = true;
      if (!datos?.campanaId) return null;
      const campana: CampanaDelAnuncio = {
        campanaId: datos.campanaId,
        campanaNombre: datos.campanaNombre,
        anuncioNombre: datos.anuncioNombre,
      };
      await guardarRecuerdo(anuncioId, campana);
      return campana;
    })
    .catch(() => {
      contesto = true;
      return null;
    });

  let reloj: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<null>((resolve) => {
    reloj = setTimeout(() => resolve(null), opciones.esperaMs ?? ESPERA_DE_META_MS);
  });
  const resultado = await Promise.race([pregunta, limite]);
  if (reloj) clearTimeout(reloj);
  if (!resultado) {
    if (contesto) {
      console.log("[reparto-por-anuncio] campaña desconocida: Meta no conoce el anuncio (o contestó con error)", { anuncioId });
    } else {
      console.log("[reparto-por-anuncio] campaña desconocida: Meta no contestó a tiempo", {
        anuncioId,
        esperaMs: opciones.esperaMs ?? ESPERA_DE_META_MS,
      });
    }
  }
  return resultado;
}

// ── Aprender los anuncios de cada campaña con regla ────────────────────────────────────────────

/** Cada cuánto, como mucho, se le vuelven a pedir a Meta los anuncios de las campañas (desde un chat). */
export const CADA_CUANTO_SE_APRENDE_MS = 15 * 60 * 1000;

/** La marca de la última vez que se le pidieron a Meta los anuncios de las campañas de ese negocio. */
export function claveDeCampanasActualizadas(workspaceId: string): string {
  return `reparto-por-anuncio:campanas-actualizadas:${workspaceId}`;
}

export type AnunciosAprendidos = { anuncios: number; campanas: number; campanasFallidas: number };

/**
 * Le pide a Meta (SOLO LECTURA) los anuncios de cada campaña con regla prendida y guarda cada uno en el
 * recuerdo `reparto-por-anuncio:campana:<anuncio>`, así el próximo chat de ese anuncio ya sabe su
 * campaña sin preguntar. null = no hay llave de Meta (no se llama a Meta). Nunca lanza.
 */
export async function aprenderAnunciosDeCampanas(
  workspaceId: string,
  reglas: ReglaDeAnuncio[],
): Promise<AnunciosAprendidos | null> {
  try {
    if (!metaAdsConfigurado()) return null;
    const campanas = [...new Set(reglas.filter((r) => r.activa && r.tipo === "campana").map((r) => r.metaId))];
    const resultado: AnunciosAprendidos = { anuncios: 0, campanas: campanas.length, campanasFallidas: 0 };
    for (const campanaId of campanas) {
      const anuncios = await listarAnunciosDeCampana(campanaId);
      if (!anuncios) {
        resultado.campanasFallidas += 1;
        continue;
      }
      for (const anuncio of anuncios) {
        if (!esIdDeMeta(anuncio.anuncioId)) continue;
        await guardarRecuerdo(anuncio.anuncioId, {
          campanaId: anuncio.campanaId || campanaId,
          campanaNombre: anuncio.campanaNombre,
          anuncioNombre: anuncio.anuncioNombre,
        });
        resultado.anuncios += 1;
      }
    }
    console.log("[reparto-por-anuncio] anuncios de las campañas aprendidos de Meta", { workspaceId, ...resultado });
    return resultado;
  } catch (error) {
    console.warn("[reparto-por-anuncio] no se pudieron aprender los anuncios de las campañas", {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { anuncios: 0, campanas: 0, campanasFallidas: 0 };
  }
}

/**
 * Lo mismo, pero como mucho una vez cada 15 minutos por negocio (para llamarla desde cada chat). La marca
 * se guarda ANTES de preguntar, así dos chats casi juntos no leen a Meta dos veces. Sin llave no se
 * llama a Meta ni se toca la marca. Devuelve si le preguntó a Meta. Nunca lanza.
 */
export async function aprenderAnunciosDeCampanasConLimite(workspaceId: string, reglas: ReglaDeAnuncio[]): Promise<boolean> {
  try {
    if (!metaAdsConfigurado()) return false;
    if (!reglas.some((regla) => regla.activa && regla.tipo === "campana")) return false;
    const clave = claveDeCampanasActualizadas(workspaceId);
    const ahora = new Date();
    const corte = new Date(ahora.getTime() - CADA_CUANTO_SE_APRENDE_MS).toISOString();
    const marca = await prisma.appSetting.findUnique({ where: { key: clave }, select: { value: true } });
    if (!marca) {
      // Si otro chat la creó al mismo tiempo, falla por clave repetida y este no pregunta.
      const creada = await prisma.appSetting
        .create({ data: { key: clave, value: ahora.toISOString() } })
        .then(() => true)
        .catch(() => false);
      if (!creada) return false;
    } else {
      // Solo gana quien encuentra la marca vieja (o rota): la actualiza y pregunta; los demás no.
      const marcaRota = Number.isNaN(Date.parse(marca.value));
      const tomada = await prisma.appSetting.updateMany({
        where: marcaRota ? { key: clave, value: marca.value } : { key: clave, value: { lt: corte } },
        data: { value: ahora.toISOString() },
      });
      if (tomada.count === 0) return false;
    }
    await aprenderAnunciosDeCampanas(workspaceId, reglas);
    return true;
  } catch (error) {
    console.warn("[reparto-por-anuncio] no se pudo revisar si toca aprender los anuncios", {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Cuántos anuncios conoce el CRM de cada campaña (por id de campaña), según los recuerdos. Nunca lanza. */
export async function anunciosConocidosPorCampana(): Promise<Record<string, number>> {
  try {
    const filas = await prisma.appSetting.findMany({
      where: { key: { startsWith: claveDeCampanaDelAnuncio("") } },
      select: { value: true },
    });
    const cuenta: Record<string, number> = {};
    for (const fila of filas) {
      const recuerdo = leerRecuerdo(fila.value);
      if (recuerdo) cuenta[recuerdo.campanaId] = (cuenta[recuerdo.campanaId] ?? 0) + 1;
    }
    return cuenta;
  } catch (error) {
    console.warn("[reparto-por-anuncio] no se pudieron contar los anuncios conocidos", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

// ── Aplicar la regla al chat ───────────────────────────────────────────────────────────────────

export type ResultadoDeLaRegla =
  | { aplicada: false }
  | { aplicada: true; regla: ReglaDeAnuncio; asesoraId: string; sinBienvenida: boolean };

const NO_APLICADA: ResultadoDeLaRegla = { aplicada: false };

/**
 * Busca la regla del anuncio y, si dice una asesora, le asigna el chat. El webhook la espera ANTES
 * del bot. Devuelve `aplicada: false` (reparto normal) si no hay regla, si la regla dice "reparto
 * normal", si el chat ya tiene dueña o si la asesora ya no está activa. Nunca lanza.
 *
 * Los avisos (WhatsApp con `avisarAsesorPorWhatsApp` y el push) van por `enSegundoPlano`, para no
 * demorar el webhook.
 */
export async function aplicarReglaDeAnuncio(input: {
  workspaceId: string;
  channelId: string;
  conversationId: string;
  contactId: string;
  anuncio: { id: string; titulo: string; red: string; ctwaClid: string };
  cliente: string;
  telefonoDelCliente: string;
  enSegundoPlano?: (tarea: () => Promise<unknown>) => void;
  esperaDeMetaMs?: number;
}): Promise<ResultadoDeLaRegla> {
  try {
    const anuncioId = esIdDeMeta(input.anuncio.id) ? input.anuncio.id : null;
    if (!anuncioId) return NO_APLICADA;

    const reglas = await leerReglas(input.workspaceId);
    if (!hayReglasEnLaLinea(reglas, input.channelId)) {
      if (reglas.some((regla) => regla.activa)) {
        console.log("[reparto-por-anuncio] esta línea no tiene reglas: las reglas prendidas son de otra línea", {
          channelId: input.channelId,
          conversationId: input.conversationId,
          anuncioId,
        });
      }
      return NO_APLICADA;
    }

    // En segundo plano (como mucho cada 15 minutos): aprender los anuncios de las campañas con regla.
    // No se espera: no demora el webhook ni cambia el resultado de esta regla.
    if (hayReglasDeCampanaEnLaLinea(reglas, input.channelId)) {
      const aprender = () => aprenderAnunciosDeCampanasConLimite(input.workspaceId, reglas);
      if (input.enSegundoPlano) input.enSegundoPlano(aprender);
      else void aprender();
    }

    let campana: CampanaDelAnuncio | null = null;
    let regla = buscarReglaDelAnuncio({ reglas, channelId: input.channelId, anuncioId, campanaId: null });
    if (!regla && hayReglasDeCampanaEnLaLinea(reglas, input.channelId)) {
      campana = await campanaDelAnuncio(input.workspaceId, anuncioId, { esperaMs: input.esperaDeMetaMs });
      regla = buscarReglaDelAnuncio({
        reglas,
        channelId: input.channelId,
        anuncioId,
        campanaId: campana?.campanaId ?? null,
      });
    }
    if (!regla || !regla.asignarA) return NO_APLICADA;
    const asesoraId = regla.asignarA;

    const [conversacion, miembro] = await Promise.all([
      prisma.conversation.findUnique({ where: { id: input.conversationId }, select: { assignedToUserId: true } }),
      prisma.workspaceMember.findFirst({
        where: { workspaceId: input.workspaceId, userId: asesoraId, isActive: true },
        select: { userId: true },
      }),
    ]);
    if (!conversacion || conversacion.assignedToUserId) return NO_APLICADA;
    // Si la asesora ya no está en el equipo, sus chats no pueden quedar esperando a nadie.
    if (!miembro) {
      console.log("[reparto-por-anuncio] la asesora de la regla no está activa: reparto normal", {
        reglaId: regla.id,
        conversationId: input.conversationId,
      });
      return NO_APLICADA;
    }

    // Solo si sigue sin dueña: dos mensajes casi juntos no pueden asignarlo dos veces.
    const asignado = await prisma.conversation.updateMany({
      where: { id: input.conversationId, assignedToUserId: null },
      data: { assignedToUserId: asesoraId },
    });
    if (asignado.count === 0) return NO_APLICADA;

    // Contador: una marca por chat asignado. Si falla, la asignación sigue igual.
    const marca = claveDeUsoDeLaRegla(input.workspaceId, regla.id, input.conversationId);
    await prisma.appSetting
      .upsert({ where: { key: marca }, create: { key: marca, value: asesoraId }, update: {} })
      .catch(() => undefined);

    // El chat ya es de la asesora: el bot queda callado siempre (con o sin "Sin bienvenida").
    await setConversationAutomationPaused({ conversationId: input.conversationId, paused: true });

    const persona = await prisma.user
      .findUnique({ where: { id: asesoraId }, select: { name: true, email: true } })
      .catch(() => null);
    const nombre = persona?.name?.trim() || persona?.email || "Colaborador";
    const nombreDeLaRegla = regla.nombre || (regla.tipo === "anuncio" ? `anuncio ${regla.metaId}` : `campaña ${regla.metaId}`);

    await recordConversationActivity({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      channelId: input.channelId,
      contactId: input.contactId,
      kind: "assigned",
      text: `${nombre} asignado por la regla del anuncio «${nombreDeLaRegla}»`,
    }).catch(() => undefined);

    // Si el lead seguía en "---", sale solo a Frío (nunca lanza; ver etapa-automatica-crm).
    await etapaAlAsignar({
      workspaceId: input.workspaceId,
      source: "agent",
      conversationId: input.conversationId,
      asesora: nombre,
    }).catch(() => null);

    // La ficha muestra la campaña: se crea la fila de origen solo si todavía no hay una.
    await prisma.origenDePauta
      .upsert({
        where: { workspaceId_contactId: { workspaceId: input.workspaceId, contactId: input.contactId } },
        create: {
          workspaceId: input.workspaceId,
          contactId: input.contactId,
          conversationId: input.conversationId,
          anuncioId,
          anuncioNombre: campana?.anuncioNombre ?? (input.anuncio.titulo || null),
          campanaId: campana?.campanaId ?? (regla.tipo === "campana" ? regla.metaId : null),
          campanaNombre: campana?.campanaNombre ?? (regla.tipo === "campana" ? regla.nombre || null : null),
          red: input.anuncio.red || null,
          ctwaClid: input.anuncio.ctwaClid || null,
          llegoEn: new Date(),
          campanaConsultadaEn: campana ? new Date() : null,
        },
        update: {},
      })
      .catch(() => undefined);

    const avisar = async () => {
      // El mismo aviso de hoy: el chat ya es de ella, así que el WhatsApp le llega a ella.
      await avisarAsesorPorWhatsApp({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        motivo: `chat nuevo del anuncio «${nombreDeLaRegla}»`,
        cliente: input.cliente,
        telefonoDelCliente: input.telefonoDelCliente,
      }).catch(() => 0);
      await avisarAsignacionPorPush({ conversationId: input.conversationId, userId: asesoraId });
    };
    if (input.enSegundoPlano) input.enSegundoPlano(avisar);
    else void avisar();

    console.log("[reparto-por-anuncio] chat asignado por regla", {
      conversationId: input.conversationId,
      reglaId: regla.id,
      tipo: regla.tipo,
      userId: asesoraId,
      sinBienvenida: regla.sinBienvenida,
    });
    return { aplicada: true, regla, asesoraId, sinBienvenida: regla.sinBienvenida };
  } catch (error) {
    console.warn("[reparto-por-anuncio] no se pudo aplicar la regla: reparto normal", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NO_APLICADA;
  }
}
