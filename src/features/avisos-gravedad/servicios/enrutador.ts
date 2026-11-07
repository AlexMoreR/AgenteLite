import { leerConfigAntiBloqueo } from "@/lib/anti-bloqueo/servicio";
import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/web-push";

import { ORIGEN_LINEA, ORIGEN_SUPERVISOR, prioridadDeGravedad } from "@/features/alertas/dominio/reglas";
import { registrarAlerta, soloUrgentesPrendido } from "@/features/alertas/servicios/alertas";
import type { Incidente } from "@/features/supervisor/dominio/alertas";
import { textoDelAviso } from "@/features/supervisor/dominio/alertas";
import { ORDEN_DE_SEVERIDAD } from "@/features/supervisor/dominio/tipos";

import {
  anotar,
  asesoraDelIncidente,
  canalesDe,
  clasificarIncidente,
  decidirPush,
  decidirWhatsApp,
  fechaBogota,
  leadsDelIncidente,
  leerConfigGravedadDeTexto,
  resumenVacio,
  type Canal,
  type ConfigGravedad,
  type Gravedad,
  type MarcaDeIncidente,
  type ResumenDelDia,
} from "../dominio/reglas";

/**
 * EL ENRUTADOR DE AVISOS POR GRAVEDAD (servicio). Las reglas están en ../dominio/reglas.ts.
 *
 * Interruptor: AppSetting `avisos:gravedad:<workspaceId>` = {"activo": true, ...}. Sin fila, o con
 * "activo" en false, NADA cambia: el bot avisa como hoy y el Supervisor manda push a OWNER/ADMIN.
 *
 * Nunca lanza: un aviso que falla no puede tumbar el chequeo ni la conversación.
 */

export const claveConfigGravedad = (workspaceId: string) => `avisos:gravedad:${workspaceId}`;
const claveEstado = (workspaceId: string) => `avisos:gravedad:estado:${workspaceId}`;
const claveResumen = (workspaceId: string, fecha: string) => `avisos:gravedad:resumen:${workspaceId}:${fecha}`;

const ENLACE_SUPERVISOR = "https://crm.magilus.com/cliente/direccion/supervisor";

const cacheConfig = new Map<string, { config: ConfigGravedad; vence: number }>();

export async function leerConfigGravedad(workspaceId: string): Promise<ConfigGravedad> {
  const guardado = cacheConfig.get(workspaceId);
  if (guardado && guardado.vence > Date.now()) return guardado.config;
  const fila = await prisma.appSetting.findUnique({ where: { key: claveConfigGravedad(workspaceId) } }).catch(() => null);
  const config = leerConfigGravedadDeTexto(fila?.value);
  cacheConfig.set(workspaceId, { config, vence: Date.now() + 60_000 });
  return config;
}

/** Para las pruebas y para cuando se cambia el ajuste. */
export function olvidarConfigGravedad(workspaceId?: string) {
  if (workspaceId) cacheConfig.delete(workspaceId);
  else cacheConfig.clear();
}

/* ------------------------------------------------------------------------------------------------
   DESTINATARIOS
------------------------------------------------------------------------------------------------ */

/** Quién es "Alexander" para el push: los de la config o, si no hay, OWNER/ADMIN activos (lo de hoy). */
export async function idsDeAlexander(workspaceId: string, config: ConfigGravedad): Promise<string[]> {
  if (config.alexanderUserIds.length) return config.alexanderUserIds;
  const jefes = await prisma.workspaceMember
    .findMany({
      where: { workspaceId, isActive: true, role: { in: ["OWNER", "ADMIN"] } },
      select: { userId: true },
    })
    .catch(() => []);
  return jefes.map((jefe) => jefe.userId);
}

type ConfigDeAvisosCruda = { canalId?: string; destinos?: Array<{ numero?: string; soloDe?: string | null; userId?: string }> };

async function leerAvisosCrudos(workspaceId: string): Promise<ConfigDeAvisosCruda> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `agente-v3:avisos:${workspaceId}` } }).catch(() => null);
  try {
    return fila?.value ? (JSON.parse(fila.value) as ConfigDeAvisosCruda) : {};
  } catch {
    return {};
  }
}

/**
 * El número y la línea INTERNA para el WhatsApp de un crítico. Nunca una línea de ventas del
 * cliente: la de la config de gravedad, la interna del anti-bloqueo o la de la config de avisos
 * (hoy, Admin). El número tiene que estar en la lista de avisos (así el agente no le contesta).
 */
export async function destinoWhatsAppCritico(
  workspaceId: string,
  config: ConfigGravedad,
): Promise<{ numero: string; canalId: string; instancia: string } | null> {
  const destino = await leerDestinoWhatsApp(workspaceId, config);
  return destino.problema === null && destino.numero && destino.linea
    ? { numero: destino.numero, canalId: destino.linea.canalId, instancia: destino.linea.instancia }
    : null;
}

const MOTIVO_APAGADO = "El WhatsApp de los avisos críticos a Alexander está apagado en el ajuste de avisos por gravedad.";

/** "…2277": el número nunca sale completo en un motivo ni en un log. */
const finDelNumero = (numero: string) => `…${numero.slice(-4)}`;

/**
 * La lectura del destino del WhatsApp a Alexander con el PORQUÉ cuando no hay. Es la única fuente
 * de las reglas: la usan `destinoWhatsAppCritico`, el envío y el estado que ve el MCP.
 */
async function leerDestinoWhatsApp(
  workspaceId: string,
  config: ConfigGravedad,
): Promise<{ numero: string | null; linea: { canalId: string; instancia: string } | null; problema: string | null }> {
  const avisos = await leerAvisosCrudos(workspaceId);
  const numerosDelEquipo = new Set((avisos.destinos ?? []).map((d) => (d.numero ?? "").replace(/\D/g, "")).filter(Boolean));
  const administrador = (avisos.destinos ?? []).find((d) => d.soloDe === null || d.soloDe === undefined);
  const leido = config.whatsapp.numero ?? (administrador?.numero ?? "").replace(/\D/g, "");
  const numero = leido && leido.length >= 10 ? leido : null;
  const linea = await lineaInterna(workspaceId, config, avisos);
  let problema: string | null = null;
  if (!numero) problema = "No hay número de WhatsApp de Alexander: falta el número de avisos del administrador en Mi empresa → Equipo.";
  else if (!numerosDelEquipo.has(numero))
    problema = `El número terminado en ${finDelNumero(numero)} no está en la lista de avisos de Mi empresa → Equipo.`;
  else if (!linea) problema = "No hay línea interna conectada para mandar el WhatsApp (la de avisos de Mi empresa → Equipo).";
  return { numero, linea, problema };
}

/** Lo que se ve desde el MCP (solo lectura): si el WhatsApp a Alexander saldría y, si no, por qué. */
export async function estadoWhatsAppDeAlexander(
  workspaceId: string,
  config: ConfigGravedad,
): Promise<{ prendido: boolean; numeroTerminaEn: string | null; linea: string | null; problema: string | null }> {
  const destino = await leerDestinoWhatsApp(workspaceId, config);
  return {
    prendido: config.whatsapp.activo,
    numeroTerminaEn: destino.numero ? destino.numero.slice(-4) : null,
    linea: destino.linea?.instancia ?? null,
    problema: config.whatsapp.activo ? destino.problema : MOTIVO_APAGADO,
  };
}

/** Un error del gateway puede traer el número: se tapa cualquier número largo. */
function sinNumeros(texto: string): string {
  return texto.replace(/\d{7,}/g, (numero) => finDelNumero(numero));
}

export type ResultadoWhatsAppAAlexander = { ok: true } | { ok: false; motivo: string; apagado?: boolean };

/**
 * WhatsApp a Alexander por la línea interna, con el motivo cuando no sale. `evitarCanalId`: la línea
 * caída. `limiteMs`: tiempo límite con el gateway (sin él, como siempre).
 */
export async function intentarWhatsAppAAlexander(input: {
  workspaceId: string;
  config: ConfigGravedad;
  texto: string;
  evitarCanalId?: string | null;
  limiteMs?: number;
}): Promise<ResultadoWhatsAppAAlexander> {
  if (!input.config.whatsapp.activo) return { ok: false, motivo: MOTIVO_APAGADO, apagado: true };
  const destino = await leerDestinoWhatsApp(input.workspaceId, input.config);
  if (destino.problema || !destino.numero || !destino.linea) {
    console.warn("[avisos-gravedad] sin línea interna o número para el WhatsApp crítico");
    return { ok: false, motivo: destino.problema ?? "No hay número o línea interna para el WhatsApp." };
  }
  if (destino.linea.canalId === input.evitarCanalId) {
    console.warn("[avisos-gravedad] sin línea interna o número para el WhatsApp crítico");
    return { ok: false, motivo: "La línea interna es la misma que está caída: no se puede avisar por ella." };
  }
  try {
    await sendEvolutionTextMessageWithReconnect({
      instanceName: destino.linea.instancia,
      phoneNumber: destino.numero,
      text: input.texto,
      ...(input.limiteMs ? { limiteMs: input.limiteMs } : {}),
    });
    return { ok: true };
  } catch (error) {
    const mensaje = sinNumeros(error instanceof Error ? error.message : String(error));
    console.warn("[avisos-gravedad] no salió el WhatsApp crítico", { numero: finDelNumero(destino.numero), error: mensaje });
    return { ok: false, motivo: `No salió el WhatsApp por la línea ${destino.linea.instancia}: ${mensaje || "error sin mensaje"}` };
  }
}

/**
 * La línea INTERNA del equipo (nunca una de ventas): la de la config de gravedad, la interna del
 * anti-bloqueo o la de la config de avisos (hoy, Admin). La usa también el Supervisor accionable
 * para el WhatsApp a la asesora.
 */
export async function lineaInterna(
  workspaceId: string,
  config: ConfigGravedad,
  avisosLeidos?: ConfigDeAvisosCruda,
): Promise<{ canalId: string; instancia: string } | null> {
  const avisos = avisosLeidos ?? (await leerAvisosCrudos(workspaceId));
  const antiBloqueo = await leerConfigAntiBloqueo(workspaceId).catch(() => null);
  const canalId = config.whatsapp.canalId ?? antiBloqueo?.avisos.canalInternoId ?? avisos.canalId ?? null;
  if (!canalId) return null;
  const linea = await prisma.whatsAppChannel
    .findFirst({ where: { id: canalId, workspaceId }, select: { id: true, evolutionInstanceName: true } })
    .catch(() => null);
  if (!linea?.evolutionInstanceName) return null;
  return { canalId: linea.id, instancia: linea.evolutionInstanceName };
}

/** El número de avisos de una persona del equipo (Mi empresa → Equipo), si lo tiene. */
export async function numeroDeAvisosDeLaPersona(workspaceId: string, userId: string): Promise<string | null> {
  const avisos = await leerAvisosCrudos(workspaceId);
  const destino = (avisos.destinos ?? []).find((d) => d.userId === userId || d.soloDe === userId);
  const numero = (destino?.numero ?? "").replace(/\D/g, "");
  return numero.length >= 10 ? numero : null;
}

export async function pushAAlexander(
  workspaceId: string,
  config: ConfigGravedad,
  payload: { title: string; body: string; tag: string; url: string },
): Promise<number> {
  let enviados = 0;
  for (const userId of await idsDeAlexander(workspaceId, config)) {
    enviados += await sendPushToUser({ userId, payload }).catch(() => 0);
  }
  return enviados;
}

/** WhatsApp de un CRÍTICO a Alexander por la línea interna. `evitarCanalId`: la línea caída. */
export async function whatsAppAAlexander(input: {
  workspaceId: string;
  config: ConfigGravedad;
  texto: string;
  evitarCanalId?: string | null;
}): Promise<boolean> {
  // Sin límite de tiempo: los envíos de incidentes, embudo y línea caída quedan como siempre.
  const resultado = await intentarWhatsAppAAlexander(input);
  return resultado.ok;
}

/* ------------------------------------------------------------------------------------------------
   ESTADO (enfriamiento) Y RESUMEN
------------------------------------------------------------------------------------------------ */

async function leerEstado(workspaceId: string): Promise<Record<string, MarcaDeIncidente>> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveEstado(workspaceId) } }).catch(() => null);
  try {
    const leido = fila?.value ? (JSON.parse(fila.value) as Record<string, MarcaDeIncidente>) : {};
    return leido && typeof leido === "object" ? leido : {};
  } catch {
    return {};
  }
}

async function guardarEstado(workspaceId: string, estado: Record<string, MarcaDeIncidente>, ahora: Date) {
  // Se olvida lo que no se ve hace 3 días.
  const limpio = Object.fromEntries(
    Object.entries(estado).filter(([, marca]) => ahora.getTime() - Date.parse(marca.vistoEn) < 3 * 86_400_000),
  );
  const key = claveEstado(workspaceId);
  const value = JSON.stringify(limpio);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } }).catch(() => {});
}

export async function leerResumenDelDia(workspaceId: string, fecha: string): Promise<ResumenDelDia> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveResumen(workspaceId, fecha) } }).catch(() => null);
  try {
    const leido = fila?.value ? (JSON.parse(fila.value) as ResumenDelDia) : null;
    return leido && leido.vistos && leido.envios ? leido : resumenVacio(fecha);
  } catch {
    return resumenVacio(fecha);
  }
}

async function anotarEnResumen(
  workspaceId: string,
  eventos: Array<{ clave: string; gravedad: Gravedad; titulo: string; canales: Canal[]; en: Date }>,
) {
  if (!eventos.length) return;
  const fecha = fechaBogota(eventos[0].en);
  let resumen = await leerResumenDelDia(workspaceId, fecha);
  for (const evento of eventos) resumen = anotar(resumen, evento);
  const key = claveResumen(workspaceId, fecha);
  const value = JSON.stringify(resumen);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } }).catch(() => {});
}

/** El aviso del bot ya salió (o no): queda en el resumen del día. */
export async function anotarAvisoDelBot(input: {
  workspaceId: string;
  conversationId: string;
  gravedad: Gravedad;
  titulo: string;
  canales: Canal[];
  ahora?: Date;
}) {
  await anotarEnResumen(input.workspaceId, [
    { clave: `bot:${input.conversationId}`, gravedad: input.gravedad, titulo: input.titulo, canales: input.canales, en: input.ahora ?? new Date() },
  ]).catch(() => {});
}

/* ------------------------------------------------------------------------------------------------
   LAS ALERTAS DEL SUPERVISOR
------------------------------------------------------------------------------------------------ */

async function enlaceDelIncidente(workspaceId: string, inc: Incidente): Promise<string> {
  const chat = inc.familia === "ATENCION" ? inc.hallazgos.flatMap((h) => h.evidencia.chats)[0] : null;
  if (!chat) return ENLACE_SUPERVISOR;
  const conversacion = await prisma.conversation
    .findFirst({ where: { id: chat, workspaceId }, select: { numero: true } })
    .catch(() => null);
  return conversacion?.numero ? `https://crm.magilus.com/c/${conversacion.numero}` : ENLACE_SUPERVISOR;
}

function textoWhatsAppCritico(inc: Incidente, motivo: string, enlace: string): string {
  const principal = [...inc.hallazgos].sort((a, b) => ORDEN_DE_SEVERIDAD[b.severidad] - ORDEN_DE_SEVERIDAD[a.severidad])[0];
  return [
    "🚨 *CRÍTICO* · Supervisor",
    "",
    `📌 ${inc.titulo}`.slice(0, 220),
    principal?.que ? principal.que.slice(0, 220) : null,
    `Motivo: ${motivo}`,
    "",
    enlace,
  ]
    .filter((linea): linea is string => linea !== null)
    .join("\n");
}

/**
 * Con el interruptor ENCENDIDO reemplaza al push de `avisarAlDueno`:
 *  - Revisa lo que el Supervisor pidió avisar (nuevo / sube / recordatorio) y, además, TODAS las
 *    alertas de atención abiertas, porque su gravedad cambia con el reloj (a las 2 h un asignado sin
 *    respuesta pasa a CRÍTICO aunque el Supervisor lo siga viendo IMPORTANTE).
 *  - Cada una sale por el canal de su gravedad, con enfriamiento.
 */
export async function enrutarAlertasDelSupervisor(input: {
  workspaceId: string;
  config: ConfigGravedad;
  avisos: Array<{ incidente: Incidente; motivo: "nuevo" | "sube" | "recordatorio" }>;
  /** Los incidentes de la vuelta (para reevaluar los de atención abiertos). */
  incidentes?: Incidente[];
  ahora: Date;
  /**
   * Supervisor accionable encendido: el WhatsApp de un CRÍTICO sale con el formato completo
   * (qué pasó · responsable · por qué te toca · tu acción · enlace). Sin esto, el texto de siempre.
   */
  textoCritico?: (inc: Incidente, motivo: string, enlace: string) => string;
}): Promise<{ enviados: number; porCanal: Record<Canal, number> }> {
  const { workspaceId, config, ahora } = input;
  const porCanal: Record<Canal, number> = { asesora_whatsapp: 0, asesora_push: 0, alexander_push: 0, alexander_whatsapp: 0, resumen: 0 };
  const candidatos = new Map<string, { incidente: Incidente; recordatorio: boolean }>();
  for (const aviso of input.avisos) candidatos.set(aviso.incidente.clave, { incidente: aviso.incidente, recordatorio: aviso.motivo === "recordatorio" });
  for (const inc of input.incidentes ?? []) {
    // Solo las que se vieron en ESTA vuelta (las que dejaron de verse están por cerrarse).
    if (inc.estado !== "ABIERTA" || inc.familia !== "ATENCION" || candidatos.has(inc.clave)) continue;
    if (inc.ultimaVezEn.getTime() !== ahora.getTime()) continue;
    candidatos.set(inc.clave, { incidente: inc, recordatorio: false });
  }
  if (!candidatos.size) return { enviados: 0, porCanal };

  const estado = await leerEstado(workspaceId);
  const eventos: Array<{ clave: string; gravedad: Gravedad; titulo: string; canales: Canal[]; en: Date }> = [];
  let enviados = 0;

  for (const { incidente: inc, recordatorio } of candidatos.values()) {
    const { gravedad, motivo } = clasificarIncidente(inc, ahora, config);
    const marca = estado[inc.clave] ?? null;
    const leads = leadsDelIncidente(inc);
    const canales = canalesDe(gravedad, { whatsappActivo: config.whatsapp.activo, asesoraTieneWhatsApp: false });
    const salieron: Canal[] = [];
    const nueva: MarcaDeIncidente = {
      gravedad,
      pushEn: marca?.pushEn ?? null,
      pushLeads: marca?.pushLeads ?? 0,
      waEn: marca?.waEn ?? null,
      waLeads: marca?.waLeads ?? 0,
      vistoEn: ahora.toISOString(),
    };

    if (gravedad === "OBSERVACION") {
      salieron.push("resumen");
    } else if (decidirPush({ marca, gravedad, leads, ahora, enfriamientoMin: config.enfriamientoMin, recordatorio })) {
      const { title, body } = textoDelAviso(inc, recordatorio ? "recordatorio" : marca && gravedad !== marca.gravedad ? "sube" : "nuevo");
      const payload = { title, body, tag: `supervisor:${inc.clave}`, url: "/cliente/direccion/supervisor" };
      if (gravedad === "OPERATIVO") {
        const asesora = asesoraDelIncidente(inc);
        if (asesora) {
          const n = await sendPushToUser({ userId: asesora, payload: { ...payload, title: "Tienes clientes esperando", url: "/cliente/crm/mi-dia" } }).catch(() => 0);
          if (n > 0) salieron.push("asesora_push");
          enviados += n;
        }
      } else {
        const n = await pushAAlexander(workspaceId, config, payload);
        if (n > 0) salieron.push("alexander_push");
        enviados += n;
      }
      nueva.pushEn = ahora.toISOString();
      nueva.pushLeads = leads;
    }

    const mandarWhatsApp = canales.includes("alexander_whatsapp") && decidirWhatsApp({ marca, leads, ahora, enfriamientoMin: config.enfriamientoMin });
    // ALERTAS (29-oct-2026): toda alerta queda en la página /cliente/alertas (CRÍTICO = Urgente, IMPORTANTE = Alta,
    // OPERATIVO = Media, OBSERVACIÓN = Baja). Se registra al verse por primera vez, al cambiar de gravedad, en un
    // recordatorio y cuando sale el WhatsApp, para no contar una repetición por cada vuelta del reloj.
    if (mandarWhatsApp || !marca || marca.gravedad !== gravedad || recordatorio) {
      const enlace = mandarWhatsApp ? await enlaceDelIncidente(workspaceId, inc) : ENLACE_SUPERVISOR;
      const soloUrgentes = await soloUrgentesPrendido(workspaceId);
      const principal = [...inc.hallazgos].sort((a, b) => ORDEN_DE_SEVERIDAD[b.severidad] - ORDEN_DE_SEVERIDAD[a.severidad])[0];
      const resultado = await registrarAlerta({
        workspaceId,
        clave: `sup:${inc.clave}`,
        prioridad: gravedad === "OPERATIVO" ? "MEDIA" : prioridadDeGravedad(gravedad),
        titulo: inc.titulo,
        detalle: [principal?.que, motivo ? `Motivo: ${motivo}` : null, enlace !== ENLACE_SUPERVISOR ? enlace : null].filter(Boolean).join("\n"),
        origen: ORIGEN_SUPERVISOR,
        // Con "solo urgentes" el WhatsApp del crítico es el corto (2 líneas y el link a la página); apagado, el de siempre.
        enviar: mandarWhatsApp
          ? (corto) =>
              whatsAppAAlexander({
                workspaceId,
                config,
                texto: soloUrgentes ? corto : input.textoCritico ? input.textoCritico(inc, motivo, enlace) : textoWhatsAppCritico(inc, motivo, enlace),
              })
          : undefined,
      });
      if (resultado.salioPorWhatsApp) {
        salieron.push("alexander_whatsapp");
        enviados += 1;
        nueva.waEn = ahora.toISOString();
        nueva.waLeads = leads;
      }
    }

    for (const canal of salieron) porCanal[canal] += 1;
    estado[inc.clave] = nueva;
    eventos.push({ clave: `sup:${inc.clave}`, gravedad, titulo: inc.titulo, canales: salieron, en: ahora });
  }

  await guardarEstado(workspaceId, estado, ahora);
  await anotarEnResumen(workspaceId, eventos).catch(() => {});
  return { enviados, porCanal };
}

/* ------------------------------------------------------------------------------------------------
   LÍNEA CAÍDA (monitor de canales): CRÍTICO
------------------------------------------------------------------------------------------------ */

/**
 * Una línea de WhatsApp caída es CRÍTICA: además del push y el correo de siempre, un WhatsApp a
 * Alexander por la línea interna (si la caída no es justamente esa). Solo con el interruptor.
 */
export async function avisarLineaCaidaPorWhatsApp(input: {
  workspaceId: string;
  canalId: string;
  titulo: string;
  cuerpo: string;
  ahora?: Date;
}): Promise<boolean> {
  try {
    const config = await leerConfigGravedad(input.workspaceId);
    const ahora = input.ahora ?? new Date();
    const clave = `LINEA:caida:${input.canalId}`;
    // Una línea caída es Urgente: queda SIEMPRE en la página de alertas, aunque el interruptor de gravedad esté apagado.
    if (!config.activo) {
      await registrarAlerta({ workspaceId: input.workspaceId, clave, prioridad: "URGENTE", titulo: input.titulo, detalle: input.cuerpo, origen: ORIGEN_LINEA });
      return false;
    }
    const estado = await leerEstado(input.workspaceId);
    const marca = estado[clave] ?? null;
    const soloUrgentes = await soloUrgentesPrendido(input.workspaceId);
    const mandar = decidirWhatsApp({ marca, leads: 1, ahora, enfriamientoMin: config.enfriamientoMin });
    const resultado = await registrarAlerta({
      workspaceId: input.workspaceId,
      clave,
      prioridad: "URGENTE",
      titulo: input.titulo,
      detalle: input.cuerpo,
      origen: ORIGEN_LINEA,
      enviar: mandar
        ? (corto) =>
            whatsAppAAlexander({
              workspaceId: input.workspaceId,
              config,
              texto: soloUrgentes ? corto : ["🚨 *CRÍTICO* · Línea de WhatsApp", "", `📌 ${input.titulo}`, input.cuerpo].join("\n"),
              evitarCanalId: input.canalId,
            })
        : undefined,
    });
    const ok = resultado.salioPorWhatsApp;
    estado[clave] = {
      gravedad: "CRITICO",
      pushEn: marca?.pushEn ?? null,
      pushLeads: 1,
      waEn: ok ? ahora.toISOString() : (marca?.waEn ?? null),
      waLeads: 1,
      vistoEn: ahora.toISOString(),
    };
    await guardarEstado(input.workspaceId, estado, ahora);
    await anotarEnResumen(input.workspaceId, [
      { clave, gravedad: "CRITICO", titulo: input.titulo, canales: ok ? ["alexander_push", "alexander_whatsapp"] : ["alexander_push"], en: ahora },
    ]);
    return ok;
  } catch (error) {
    console.warn("[avisos-gravedad] línea caída", error instanceof Error ? error.message : error);
    return false;
  }
}

/** La línea volvió: se olvida la marca para que la próxima caída vuelva a avisar. */
export async function olvidarLineaCaida(workspaceId: string, canalId: string): Promise<void> {
  try {
    const config = await leerConfigGravedad(workspaceId);
    if (!config.activo) return;
    const estado = await leerEstado(workspaceId);
    const clave = `LINEA:caida:${canalId}`;
    if (!estado[clave]) return;
    delete estado[clave];
    await guardarEstado(workspaceId, estado, new Date());
  } catch {
    // nada: es solo la marca del enfriamiento
  }
}
