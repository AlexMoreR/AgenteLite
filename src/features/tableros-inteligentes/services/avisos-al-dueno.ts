import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";

import { ultimoLatido } from "./coordinador-en-vivo";
import { porQueElPlanEsperaTuSi } from "./reglas-riesgo";
import { linkDeLaTarjeta } from "./tableros";

/*
  AVISOS AL DUEÑO por WhatsApp (24-oct-2026). Decisión del dueño: "solo cuando sea algo súper importante;
  lo que están desarrollando lo puedo mirar en el tablero". NO se avisa por empezar, terminar, resúmenes
  ni avances. SÍ, y solo estos cinco casos:
    1. caido        el Coordinador (aizen1) no da señales hace más de 10 minutos;
    2. sin_trabajo  nada en curso ni en fila y hay tarjetas esperando al dueño;
    3. trabado      una tarjeta lleva más de 2 horas en el mismo estado, o quedó en ERROR;
    4. necesita     algo que el sistema no puede hacer solo (clave, acceso, decisión, plan con dinero/Meta Ads);
    5. limite       se agotó el uso de Claude y no queda otro motor (lo avisa el Coordinador por /api/trabajador/aviso).

  Reglas de todos: mensaje de máximo 3 líneas con link; un solo aviso por problema y, si sigue igual, otro
  después de 3 horas; silencio de 9:00 p. m. a 7:00 a. m. (Bogotá) salvo "caído"; interruptor (prendido por
  defecto). Sale SOLO por la línea Admin y SOLO al número personal del dueño guardado en Mi empresa → Claude,
  que se valida acá en el servidor. Todo se guarda en AppSetting (sin tablas nuevas).

  Lo revisa el reloj del servidor (api/cron/follows, cada minuto). Las funciones puras se prueban sin base con
  `npm run test:tablero-avisos-al-dueno`.
*/

export const LINEA_ADMIN_ID = "cmt06kiob00lw2hk2mgllstsb";
export const MINUTOS_SIN_SENALES = 10;
export const HORAS_ATASCADA = 2;
export const MINUTOS_SIN_TRABAJO = 10;
export const HORAS_ENTRE_AVISOS = 3;
const HORAS_VALE_UN_PENDIENTE = 12;
const MAXIMO_HISTORIAL = 20;
const MAXIMO_LINEA = 220;
const MS_MINUTO = 60_000;
const MS_HORA = 3_600_000;
const BOGOTA_MS = 5 * MS_HORA;

export const claveTelefonoDeAviso = (workspaceId: string) => `trabajador:aviso-telefono:${workspaceId}`;
export const claveDelTelefonoDelDueno = (workspaceId: string) => `tablero:avisos-dueno:telefono:${workspaceId}`;
export const claveDelInterruptorDeAvisos = (workspaceId: string) => `tablero:avisos-dueno:activo:${workspaceId}`;
export const claveDelEstadoDeAvisos = (workspaceId: string) => `tablero:avisos-dueno:estado:${workspaceId}`;

export type TipoDeAviso = "caido" | "sin_trabajo" | "trabado" | "necesita" | "limite";
export const TIPOS_DEL_COORDINADOR: readonly TipoDeAviso[] = ["limite", "necesita"];

/** Un problema que merece aviso. `clave` identifica "el mismo problema" para no repetirlo. */
export type Problema = { clave: string; tipo: TipoDeAviso; texto: string; tarjetaId?: string };

type Pendiente = Problema & { hasta: string };
type EntradaDelHistorial = { cuando: string; tipos: string; texto: string; salio: boolean; motivo: string | null };
export type EstadoDeAvisos = { problemas: Record<string, string>; pendientes: Pendiente[]; historial: EntradaDelHistorial[] };

const comoTexto = (valor: unknown) => (typeof valor === "string" && valor.trim() ? valor.trim() : null);

/* ───────────────────────────────────────────────────────────── hora y números ── */

/** La hora (0 a 23) en Bogotá, que no tiene horario de verano. */
export function horaEnBogota(ahora: Date): number {
  return new Date(ahora.getTime() - BOGOTA_MS).getUTCHours();
}

/** Silencio de 9:00 p. m. a 7:00 a. m. */
export function enSilencio(ahora: Date): boolean {
  const hora = horaEnBogota(ahora);
  return hora >= 21 || hora < 7;
}

/** Solo dígitos con indicativo: 10 dígitos que empiezan en 3 son celular de Colombia y se les pone el 57. null si no sirve. */
export function normalizarTelefono(valor: string | null | undefined): string | null {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  if (/^3\d{9}$/.test(digitos)) return `57${digitos}`;
  return digitos.length >= 11 && digitos.length <= 15 ? digitos : null;
}

const ultimos10 = (valor: string | null | undefined) => String(valor ?? "").replace(/\D/g, "").slice(-10);

function duracion(ms: number): string {
  const minutos = Math.max(1, Math.round(ms / MS_MINUTO));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

const unaLinea = (valor: string, maximo = MAXIMO_LINEA) => {
  const limpio = valor.replace(/\s+/g, " ").trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1).trimEnd()}…` : limpio;
};

const sinTildes = (valor: string) => valor.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/* ───────────────────────────────────────────────────────────── los 5 casos (puro) ── */

export type TarjetaParaAvisar = {
  id: string;
  titulo: string;
  estado: string;
  plan: string | null;
  zonaProtegida: readonly string[];
  /** Desde cuándo está en este estado (el último cambio de estado del historial; el latido no cuenta). */
  desde: Date;
  /** La causa del último intento fallido, si lo hay. */
  causa: string | null;
};

export type InstantaneaDeAvisos = {
  ahora: Date;
  /** Cuándo el CRM recibió el último latido del Coordinador; null = nunca ha dado señales. */
  ultimoLatidoEn: string | null;
  tarjetas: readonly TarjetaParaAvisar[];
};

const EN_MARCHA = ["PLANEANDO", "EN_CURSO", "SUBIENDO"];
const EN_FILA = ["APROBADO", "PLAN_APROBADO"];
const ESPERAN_AL_DUENO = ["POR_APROBAR", "PLAN_LISTO", "POR_REVISAR", "ERROR"];
const QUE_HACE: Record<string, string> = { PLANEANDO: "planeando", EN_CURSO: "construyendo", SUBIENDO: "subiendo" };
const QUE_NECESITA: Record<string, string> = {
  POR_APROBAR: "aprobar la tarea",
  PLAN_LISTO: "aprobar el plan",
  POR_REVISAR: "revisar el resultado",
  ERROR: "ver el error",
};

const PIDE_ACCESO = /\b(clave\w*|acceso\w*|permiso\w*|credencial\w*|tokens?|contrasena\w*|api ?key|autenticaci\w*|no autorizad\w*|unauthorized|forbidden|permission denied|eacces|login|sesion expirada|401|403)\b/;

/** Todos los problemas que hay AHORA, sin mirar a quién ya se le avisó. */
export function evaluarProblemas(foto: InstantaneaDeAvisos): Problema[] {
  const problemas: Problema[] = [];
  const ahora = foto.ahora.getTime();

  // 1. Coordinador caído. Sin ningún latido nunca no se avisa: no se sabe si alguna vez se prendió.
  const ultimo = foto.ultimoLatidoEn ? Date.parse(foto.ultimoLatidoEn) : NaN;
  const caido = Number.isFinite(ultimo) && ahora - ultimo > MINUTOS_SIN_SENALES * MS_MINUTO;
  if (caido) {
    problemas.push({
      clave: "caido",
      tipo: "caido",
      texto: `🔴 Sistemas detenido: el Coordinador (aizen1) no da señales hace ${duracion(ahora - ultimo)}. Puede estar apagado, caído o sin internet.`,
    });
  }

  // 4 y 3. Tarjetas que necesitan al dueño o están trabadas.
  for (const tarjeta of foto.tarjetas) {
    const titulo = `«${unaLinea(tarjeta.titulo, 70)}»`;
    if (tarjeta.estado === "PLAN_LISTO") {
      const motivo = tarjeta.plan ? porQueElPlanEsperaTuSi(tarjeta.plan) : null;
      const meta = tarjeta.zonaProtegida.includes("META_ADS") ? "toca Meta Ads (zona protegida)" : null;
      if (motivo || meta) {
        problemas.push({
          clave: `necesita:${tarjeta.id}:plan`,
          tipo: "necesita",
          tarjetaId: tarjeta.id,
          texto: `🟠 Sistemas necesita su decisión: ${titulo}, ${unaLinea(motivo ?? meta ?? "", 150)}.`,
        });
      }
    } else if (tarjeta.estado === "ERROR") {
      const causa = unaLinea(tarjeta.causa ?? "sin causa registrada", 150);
      if (PIDE_ACCESO.test(sinTildes(causa))) {
        problemas.push({
          clave: `necesita:${tarjeta.id}:acceso`,
          tipo: "necesita",
          tarjetaId: tarjeta.id,
          texto: `🟠 Sistemas necesita una clave, acceso o permiso: ${titulo}. Causa: ${causa}`,
        });
      } else {
        problemas.push({
          clave: `trabado:${tarjeta.id}:error`,
          tipo: "trabado",
          tarjetaId: tarjeta.id,
          texto: `🔴 Sistemas trabado: ${titulo} quedó en error. Causa: ${causa}`,
        });
      }
    } else if (EN_MARCHA.includes(tarjeta.estado) && ahora - tarjeta.desde.getTime() > HORAS_ATASCADA * MS_HORA) {
      problemas.push({
        clave: `trabado:${tarjeta.id}:${tarjeta.estado}`,
        tipo: "trabado",
        tarjetaId: tarjeta.id,
        texto: `🔴 Sistemas trabado: ${titulo} lleva ${duracion(ahora - tarjeta.desde.getTime())} ${QUE_HACE[tarjeta.estado]} sin avanzar.`,
      });
    }
  }

  // 2. Sin trabajo (si el Coordinador está caído, ya se avisó eso: es la causa).
  if (!caido) {
    const hayEnMarcha = foto.tarjetas.some((t) => EN_MARCHA.includes(t.estado));
    const hayEnFila = foto.tarjetas.some((t) => EN_FILA.includes(t.estado));
    const esperando = foto.tarjetas.filter((t) => ESPERAN_AL_DUENO.includes(t.estado));
    // Un ERROR ya se avisa como "trabado": solo con errores no se repite como "sin trabajo".
    const hayQueDecidir = esperando.some((t) => t.estado !== "ERROR");
    // Tiene que llevar un rato quieto: si algo cambió hace menos de 10 min (acaba de terminar la última), no es "sin trabajo" todavía.
    const ultimoCambio = Math.max(0, ...foto.tarjetas.map((t) => t.desde.getTime()));
    const quieto = ahora - ultimoCambio >= MINUTOS_SIN_TRABAJO * MS_MINUTO;
    if (!hayEnMarcha && !hayEnFila && hayQueDecidir && quieto) {
      const lista = esperando.slice(0, 3).map((t) => `«${unaLinea(t.titulo, 50)}» (${QUE_NECESITA[t.estado]})`);
      if (esperando.length > 3) lista.push(`y ${esperando.length - 3} más`);
      problemas.push({
        clave: "sin_trabajo",
        tipo: "sin_trabajo",
        texto: `🟡 Sistemas sin trabajo: nada en curso ni en fila. Esperan por usted: ${lista.join(", ")}.`,
      });
    }
  }
  return problemas;
}

/* ───────────────────────────────────────────────────────────── a quién y cuándo (puro) ── */

export function estadoVacio(): EstadoDeAvisos {
  return { problemas: {}, pendientes: [], historial: [] };
}

export function leerEstado(valor: string | null | undefined): EstadoDeAvisos {
  const base = estadoVacio();
  if (!valor) return base;
  try {
    const leido = JSON.parse(valor) as Partial<EstadoDeAvisos>;
    if (leido.problemas && typeof leido.problemas === "object") {
      for (const [clave, cuando] of Object.entries(leido.problemas)) if (typeof cuando === "string") base.problemas[clave] = cuando;
    }
    if (Array.isArray(leido.pendientes)) {
      base.pendientes = leido.pendientes.filter((p): p is Pendiente => Boolean(p && typeof p.clave === "string" && typeof p.texto === "string" && typeof p.hasta === "string" && typeof p.tipo === "string"));
    }
    if (Array.isArray(leido.historial)) {
      base.historial = leido.historial.filter((h): h is EntradaDelHistorial => Boolean(h && typeof h.cuando === "string" && typeof h.texto === "string"));
    }
  } catch {
    // Ajuste dañado: se empieza de cero.
  }
  return base;
}

/**
 * De los problemas de ahora (más los pendientes del Coordinador), cuáles hay que avisar YA:
 * los que no se avisaron nunca o se avisaron hace 3 horas o más, y que no caen en el silencio
 * (solo "caído" lo atraviesa). También devuelve el estado sin los problemas que ya se resolvieron.
 */
export function decidirAvisos(
  problemas: readonly Problema[],
  estado: EstadoDeAvisos,
  ahora: Date,
  { olvidarResueltos = true }: { olvidarResueltos?: boolean } = {},
): { aEnviar: Problema[]; estado: EstadoDeAvisos } {
  const vivos = new Map<string, Problema>();
  for (const problema of problemas) vivos.set(problema.clave, problema);
  const pendientes = estado.pendientes.filter((p) => Date.parse(p.hasta) > ahora.getTime());
  for (const { clave, tipo, texto, tarjetaId } of pendientes) if (!vivos.has(clave)) vivos.set(clave, { clave, tipo, texto, tarjetaId });

  // Se olvida lo resuelto, así si vuelve a pasar se avisa de nuevo. Los del Coordinador no se evalúan acá: duran un día.
  const conservados: Record<string, string> = {};
  for (const [clave, cuando] of Object.entries(estado.problemas)) {
    // Con `olvidarResueltos` apagado (un aviso suelto del Coordinador) la lista de problemas no está completa: no se olvida nada.
    const viene = !olvidarResueltos || vivos.has(clave) || (clave.startsWith("coord:") && ahora.getTime() - Date.parse(cuando) < 24 * MS_HORA);
    if (viene) conservados[clave] = cuando;
  }

  const callado = enSilencio(ahora);
  const aEnviar = [...vivos.values()].filter((problema) => {
    if (callado && problema.tipo !== "caido") return false;
    const antes = Date.parse(conservados[problema.clave] ?? "");
    return !Number.isFinite(antes) || ahora.getTime() - antes >= HORAS_ENTRE_AVISOS * MS_HORA;
  });
  return { aEnviar, estado: { ...estado, problemas: conservados, pendientes } };
}

const PRIORIDAD: Record<TipoDeAviso, number> = { caido: 0, limite: 1, necesita: 2, trabado: 3, sin_trabajo: 4 };

/** El mensaje: máximo 3 líneas, la última siempre el link (a la tarjeta si es un solo problema de una tarjeta). */
export function armarMensaje(problemas: readonly Problema[], linkGeneral: string): string {
  const ordenados = [...problemas].sort((a, b) => PRIORIDAD[a.tipo] - PRIORIDAD[b.tipo]);
  if (!ordenados.length) return "";
  const lineas = ordenados.length <= 2 ? ordenados.map((p) => unaLinea(p.texto)) : [unaLinea(ordenados[0].texto), `…y ${ordenados.length - 1} problemas más, véalos en el tablero.`];
  const link = ordenados.length === 1 && ordenados[0].tarjetaId ? linkDeLaTarjeta(ordenados[0].tarjetaId) : linkGeneral;
  return [...lineas, link].join("\n");
}

/** Lo que manda el Coordinador (tipo limite o necesita): hasta 2 líneas; el link lo pone el CRM. */
export function problemaDelCoordinador(tipo: unknown, texto: unknown): Problema | null {
  if (typeof tipo !== "string" || !(TIPOS_DEL_COORDINADOR as readonly string[]).includes(tipo)) return null;
  const lineas = String(texto ?? "")
    .split(/\r?\n/)
    .map((linea) => unaLinea(linea))
    .filter((linea) => linea && !/^https?:\/\//i.test(linea))
    .slice(0, 2);
  if (!lineas.length) return null;
  const huella = sinTildes(lineas[0]).replace(/\d+/g, "#").replace(/[^a-z#]+/g, "").slice(0, 40);
  return { clave: `coord:${tipo}:${huella}`, tipo: tipo as TipoDeAviso, texto: lineas.join(" ") };
}

/* ───────────────────────────────────────────────────────────── ajustes (AppSetting) ── */

async function leerAjuste(key: string) {
  return (await prisma.appSetting.findUnique({ where: { key }, select: { value: true } }))?.value ?? null;
}

async function guardarAjuste(key: string, value: string) {
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** ¿Están prendidos los avisos? Sin ajuste guardado, sí. */
export async function avisosAlDuenoPrendidos(workspaceId: string): Promise<boolean> {
  return (await leerAjuste(claveDelInterruptorDeAvisos(workspaceId))) !== "false";
}

export async function ponerAvisosAlDueno(workspaceId: string, prendidos: boolean) {
  await guardarAjuste(claveDelInterruptorDeAvisos(workspaceId), prendidos ? "true" : "false");
}

/** El número del dueño: el de Mi empresa → Claude; si está vacío, el ajuste viejo por si alguien lo llenó a mano. */
export async function telefonoDelDueno(workspaceId: string): Promise<string | null> {
  const [nuevo, viejo] = await Promise.all([leerAjuste(claveDelTelefonoDelDueno(workspaceId)), leerAjuste(claveTelefonoDeAviso(workspaceId))]);
  return normalizarTelefono(nuevo) ?? normalizarTelefono(viejo);
}

/**
 * ¿Este número puede recibir los avisos? Rechaza el que no sirve, el de una asesora (miembro del equipo que no
 * es el dueño), el de una línea de WhatsApp del negocio y el de un cliente (contacto).
 */
export async function validarTelefonoDelDueno(workspaceId: string, valor: string): Promise<{ ok: true; numero: string } | { ok: false; error: string }> {
  const numero = normalizarTelefono(valor);
  if (!numero) return { ok: false, error: "El número no sirve: escríbalo solo con dígitos y con indicativo (por ejemplo 573001234567)." };
  const cola = ultimos10(numero);
  const [negocio, miembros, lineas, contacto] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } }),
    prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true, role: true, user: { select: { phone: true } } }, take: 500 }),
    prisma.whatsAppChannel.findMany({ where: { workspaceId }, select: { phoneNumber: true }, take: 200 }),
    prisma.contact.findFirst({ where: { workspaceId, phoneNumber: { endsWith: cola } }, select: { id: true } }),
  ]);
  if (miembros.some((m) => m.role !== "OWNER" && m.userId !== negocio?.ownerId && ultimos10(m.user.phone) === cola)) {
    return { ok: false, error: "Ese número es de una asesora o de una persona del equipo: los avisos son solo para el dueño." };
  }
  if (lineas.some((l) => ultimos10(l.phoneNumber) === cola)) {
    return { ok: false, error: "Ese número es de una línea de WhatsApp del negocio: escriba su número personal." };
  }
  if (contacto) return { ok: false, error: "Ese número es de un cliente: los avisos son solo para el dueño." };
  return { ok: true, numero };
}

export async function guardarTelefonoDelDueno(workspaceId: string, valor: string): Promise<{ ok: true; numero: string } | { ok: false; error: string }> {
  const validado = await validarTelefonoDelDueno(workspaceId, valor);
  if (validado.ok) await guardarAjuste(claveDelTelefonoDelDueno(workspaceId), validado.numero);
  return validado;
}

export async function estadoDeAvisosDelNegocio(workspaceId: string): Promise<EstadoDeAvisos> {
  return leerEstado(await leerAjuste(claveDelEstadoDeAvisos(workspaceId)));
}

async function guardarEstado(workspaceId: string, estado: EstadoDeAvisos) {
  const recortado = { ...estado, historial: estado.historial.slice(-MAXIMO_HISTORIAL) };
  await guardarAjuste(claveDelEstadoDeAvisos(workspaceId), JSON.stringify(recortado));
}

/* ───────────────────────────────────────────────────────────── el envío ── */

/** La línea Admin: la de id fijo del negocio; si no existe ahí, la que se llama "Admin". Conectada primero. Nunca una de ventas. */
async function lineaAdmin(workspaceId: string) {
  const lineas = await prisma.whatsAppChannel.findMany({
    where: {
      workspaceId,
      isActive: true,
      evolutionInstanceName: { not: null },
      OR: [{ id: LINEA_ADMIN_ID }, { name: { equals: "Admin", mode: "insensitive" } }],
    },
    select: { id: true, name: true, status: true, evolutionInstanceName: true },
  });
  const puntaje = (linea: (typeof lineas)[number]) => (linea.id === LINEA_ADMIN_ID ? 4 : 0) + (linea.status === "CONNECTED" ? 1 : 0);
  return [...lineas].sort((a, b) => puntaje(b) - puntaje(a))[0] ?? null;
}

const enCurso = new Set<string>();

/** Manda un texto al número personal del dueño por la línea Admin. Nunca lanza: devuelve si salió y, si no, por qué. */
export async function mandarAlDueno(workspaceId: string, texto: string): Promise<{ salio: boolean; motivo: string | null }> {
  const guardado = await telefonoDelDueno(workspaceId);
  if (!guardado) return { salio: false, motivo: "falta su número en Mi empresa → Claude" };
  // Se vuelve a validar al enviar: el aviso solo puede ir a un número que no sea de equipo, línea o cliente.
  const validado = await validarTelefonoDelDueno(workspaceId, guardado);
  if (!validado.ok) return { salio: false, motivo: validado.error };
  const linea = await lineaAdmin(workspaceId);
  if (!linea?.evolutionInstanceName) return { salio: false, motivo: "no hay una línea Admin activa en el negocio" };
  try {
    await sendEvolutionTextMessageWithReconnect({ instanceName: linea.evolutionInstanceName, phoneNumber: validado.numero, text: texto });
    return { salio: true, motivo: null };
  } catch (error) {
    console.warn("[avisos-al-dueno] no salió el WhatsApp", { numero: `…${validado.numero.slice(-4)}`, error: error instanceof Error ? error.message : String(error) });
    return { salio: false, motivo: "la línea Admin no pudo enviar el mensaje (¿está desconectada?)" };
  }
}

const linkGeneral = () => linkDeLaTarjeta("x").split("?")[0];

function anotarEnHistorial(estado: EstadoDeAvisos, entrada: EntradaDelHistorial) {
  const ultimo = estado.historial[estado.historial.length - 1];
  // Si falla igual que la vez anterior (la vuelta es cada minuto), no se llena la lista con lo mismo.
  const repetido = !entrada.salio && ultimo && !ultimo.salio && ultimo.motivo === entrada.motivo && Date.parse(entrada.cuando) - Date.parse(ultimo.cuando) < 30 * MS_MINUTO;
  if (!repetido) estado.historial.push(entrada);
}

/**
 * Junta los problemas en UN mensaje, los anota como avisados ANTES de mandar (dos vueltas seguidas no repiten) y,
 * si no salió, los desanota para reintentar en la siguiente vuelta. Nunca lanza.
 */
async function enviarProblemas(workspaceId: string, estado: EstadoDeAvisos, aEnviar: readonly Problema[], ahora: Date) {
  const texto = armarMensaje(aEnviar, linkGeneral());
  const previos = new Map(aEnviar.map((p) => [p.clave, estado.problemas[p.clave]]));
  const claves = new Set(aEnviar.map((p) => p.clave));
  for (const p of aEnviar) estado.problemas[p.clave] = ahora.toISOString();
  await guardarEstado(workspaceId, estado);
  const resultado = await mandarAlDueno(workspaceId, texto);
  // El envío tarda: se vuelve a leer el estado para no pisar lo que otra vuelta o un aviso del Coordinador guardó mientras tanto.
  const fresco = await estadoDeAvisosDelNegocio(workspaceId);
  if (resultado.salio) {
    for (const p of aEnviar) fresco.problemas[p.clave] = ahora.toISOString();
    fresco.pendientes = fresco.pendientes.filter((p) => !claves.has(p.clave));
  } else {
    for (const [clave, antes] of previos) {
      if (antes) fresco.problemas[clave] = antes;
      else delete fresco.problemas[clave];
    }
  }
  anotarEnHistorial(fresco, { cuando: ahora.toISOString(), tipos: [...new Set(aEnviar.map((p) => p.tipo))].join(","), texto, salio: resultado.salio, motivo: resultado.motivo });
  await guardarEstado(workspaceId, fresco);
  return resultado;
}

/* ───────────────────────────────────────────────────────────── la base ── */

async function leerInstantanea(workspaceId: string, ahora: Date): Promise<InstantaneaDeAvisos> {
  const [latido, filas] = await Promise.all([
    ultimoLatido(workspaceId),
    prisma.tarjetaTablero.findMany({
      where: {
        tablero: { workspaceId },
        borradoEn: null,
        repo: { not: null },
        tipo: { requiereAprobacion: true, usaEstados: true },
        estado: { in: ["POR_APROBAR", "APROBADO", "PLANEANDO", "PLAN_LISTO", "PLAN_APROBADO", "EN_CURSO", "POR_REVISAR", "SUBIENDO", "ERROR"] },
      },
      // Las más recientes primero: las viejas que se quedaron esperando no deben sacar de la foto a las que están en marcha.
      orderBy: { actualizadoEn: "desc" },
      take: 300,
      select: {
        id: true,
        titulo: true,
        estado: true,
        plan: true,
        zonaProtegida: true,
        trabajoIniciadoEn: true,
        actualizadoEn: true,
        historial: { where: { accion: { in: ["estado", "aprobar"] } }, orderBy: { creadoEn: "desc" }, take: 1, select: { creadoEn: true } },
        intentosDeTrabajo: { orderBy: { creadoEn: "desc" }, take: 1, select: { causa: true } },
      },
    }),
  ]);
  return {
    ahora,
    ultimoLatidoEn: latido?.recibidoEn ?? null,
    tarjetas: filas.map((fila) => ({
      id: fila.id,
      titulo: fila.titulo,
      estado: fila.estado,
      plan: fila.plan,
      zonaProtegida: fila.zonaProtegida,
      desde: fila.historial[0]?.creadoEn ?? fila.trabajoIniciadoEn ?? fila.actualizadoEn,
      causa: comoTexto(fila.intentosDeTrabajo[0]?.causa),
    })),
  };
}

/** Revisa un negocio y avisa lo que toque. Nunca lanza. */
async function revisarNegocio(workspaceId: string, ahora: Date): Promise<number> {
  if (enCurso.has(workspaceId)) return 0;
  enCurso.add(workspaceId);
  try {
    if (!(await avisosAlDuenoPrendidos(workspaceId))) return 0;
    const estado = await estadoDeAvisosDelNegocio(workspaceId);
    const problemas = evaluarProblemas(await leerInstantanea(workspaceId, ahora));
    const decision = decidirAvisos(problemas, estado, ahora);
    if (!decision.aEnviar.length) {
      // Aunque no haya nada que mandar, se guarda lo resuelto para que si vuelve a pasar se avise de nuevo.
      if (JSON.stringify(decision.estado.problemas) !== JSON.stringify(estado.problemas) || decision.estado.pendientes.length !== estado.pendientes.length) {
        await guardarEstado(workspaceId, decision.estado);
      }
      return 0;
    }
    const resultado = await enviarProblemas(workspaceId, decision.estado, decision.aEnviar, ahora);
    return resultado.salio ? 1 : 0;
  } catch (error) {
    console.error("[avisos-al-dueno] revisión falló", { workspaceId, error: error instanceof Error ? error.message : String(error) });
    return 0;
  } finally {
    enCurso.delete(workspaceId);
  }
}

/** La vuelta del reloj (cada minuto): por cada negocio con tableros, avisa solo los 5 casos. */
export async function revisarAvisosAlDueno(ahora = new Date()): Promise<{ enviados: number }> {
  const negocios = await prisma.tableroInteligente.findMany({ distinct: ["workspaceId"], select: { workspaceId: true } });
  let enviados = 0;
  for (const { workspaceId } of negocios) enviados += await revisarNegocio(workspaceId, ahora);
  return { enviados };
}

/**
 * Un aviso del Coordinador (POST /api/trabajador/aviso). Solo cuenta el tipo "limite" o "necesita"; sin tipo
 * se descarta sin error (un Coordinador viejo mandaba el aviso del umbral). Si cae en el silencio, o no salió,
 * queda pendiente 12 horas y la vuelta del reloj lo manda apenas se pueda.
 */
export async function recibirAvisoDelCoordinador(workspaceId: string, tipo: unknown, texto: unknown, ahora = new Date()) {
  const problema = problemaDelCoordinador(tipo, texto);
  if (!problema) return { enviado: false, descartado: true, motivo: "solo se avisan los tipos limite y necesita" };
  if (!(await avisosAlDuenoPrendidos(workspaceId))) return { enviado: false, descartado: false, motivo: "los avisos al dueño están apagados" };
  const estado = await estadoDeAvisosDelNegocio(workspaceId);
  const decision = decidirAvisos([problema], estado, ahora, { olvidarResueltos: false });
  if (!decision.aEnviar.length) {
    const antes = Date.parse(estado.problemas[problema.clave] ?? "");
    const yaAvisado = Number.isFinite(antes) && ahora.getTime() - antes < HORAS_ENTRE_AVISOS * MS_HORA;
    if (!yaAvisado && !estado.pendientes.some((p) => p.clave === problema.clave)) {
      estado.pendientes.push({ ...problema, hasta: new Date(ahora.getTime() + HORAS_VALE_UN_PENDIENTE * MS_HORA).toISOString() });
      await guardarEstado(workspaceId, estado);
    }
    return { enviado: false, descartado: false, motivo: yaAvisado ? "ya se avisó hace menos de 3 horas" : "silencio nocturno: sale a las 7:00 a. m." };
  }
  const resultado = await enviarProblemas(workspaceId, decision.estado, decision.aEnviar, ahora);
  if (!resultado.salio) {
    const despues = await estadoDeAvisosDelNegocio(workspaceId);
    despues.pendientes = despues.pendientes.filter((p) => p.clave !== problema.clave);
    despues.pendientes.push({ ...problema, hasta: new Date(ahora.getTime() + HORAS_VALE_UN_PENDIENTE * MS_HORA).toISOString() });
    await guardarEstado(workspaceId, despues);
  }
  return { enviado: resultado.salio, descartado: false, motivo: resultado.motivo };
}

/** El mensaje de prueba (botón "Mandar prueba" y el que se manda al terminar esta tarea). Respeta que el número sea válido y la línea Admin. */
export async function mandarPruebaAlDueno(workspaceId: string, ahora = new Date()) {
  const texto = ["✅ Prueba de los avisos de Sistemas: así le llegarán, solo cuando algo se detenga o lo necesite.", linkGeneral()].join("\n");
  const resultado = await mandarAlDueno(workspaceId, texto);
  const estado = await estadoDeAvisosDelNegocio(workspaceId);
  estado.historial.push({ cuando: ahora.toISOString(), tipos: "prueba", texto, salio: resultado.salio, motivo: resultado.motivo });
  await guardarEstado(workspaceId, estado);
  return resultado;
}

/** Lo que se ve en la caja de Mi empresa → Claude. */
export async function avisosParaLaPantalla(workspaceId: string) {
  const [prendidos, numero, estado] = await Promise.all([avisosAlDuenoPrendidos(workspaceId), telefonoDelDueno(workspaceId), estadoDeAvisosDelNegocio(workspaceId)]);
  return {
    prendidos,
    numero,
    ultimos: [...estado.historial].reverse().slice(0, 10),
  };
}

/** Para `que_es_esta_aplicacion`: el estado en vivo de la automatización. */
export async function estadoDeLosAvisosAlDueno(workspaceId: string) {
  const vista = await avisosParaLaPantalla(workspaceId);
  return { prendidos: vista.prendidos, hayNumero: Boolean(vista.numero), ultimoAviso: vista.ultimos.find((e) => e.tipos !== "prueba") ?? null };
}
