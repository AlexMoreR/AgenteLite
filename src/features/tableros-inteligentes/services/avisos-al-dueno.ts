import type { EstadoTarjeta } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { porQueElPlanEsperaTuSi } from "./reglas-riesgo";

/*
  AVISOS AL DUEÑO por WhatsApp (24-oct-2026, decisión del dueño por voz): "que me lleguen avisos de WhatsApp
  solo cuando sea algo realmente súper importante; lo que están desarrollando lo miro en el tablero".

  NO avisa: empezó, terminó, resúmenes ni avances. SÍ avisa (mensaje corto, máximo 3 líneas, con link):
    1. COORDINADOR CAÍDO   aizen1 no usa su clave hace más de 10 minutos.
    2. SIN TRABAJO         nada en curso ni en fila y hay tarjetas esperando al dueño (cuáles y qué necesitan).
    3. TRABADO             una tarjeta lleva más de 2 horas en PLANEANDO / EN_CURSO / SUBIENDO sin cambiar de
                           estado (el latido no cuenta), o quedó en ERROR (el Coordinador solo la deja en ERROR
                           después de sus 3 reparaciones o si no se puede reparar).
    4. NECESITA AL DUEÑO   algo que el sistema no puede hacer solo: un plan que toca dinero o Meta Ads, o un error
                           por falta de clave, acceso o permiso. También lo puede mandar el Coordinador.
    5. LÍMITE DE CLAUDE    lo manda el Coordinador (POST /api/trabajador/aviso con tipo "limite") cuando se agotó
                           el uso y no queda otro motor.

  REGLAS: va SOLO al número personal del dueño (guardado en Mi empresa → Claude y validado acá, en el servidor;
  nunca a una asesora, a un cliente ni a una línea del negocio) y SIEMPRE por la línea Admin (nunca una de
  ventas). Un solo aviso por problema: se repite solo si sigue igual pasadas 3 horas. Silencio de 9:00 p. m. a
  7:00 a. m. (Bogotá), salvo el Coordinador caído. Con el interruptor apagado no sale nada (empieza prendido).

  Todo vive en AppSetting (sin migración). Lo ya avisado se anota ahí, así un reinicio del CRM no repite avisos.
*/

/** La línea Admin del negocio de Alexander. Si no existe en el negocio, se usa la llamada "Admin". */
export const LINEA_ADMIN_ID = "cmt06kiob00lw2hk2mgllstsb";

export const MINUTOS_SIN_SENALES = 10;
export const HORAS_ATASCADA = 2;
export const HORAS_ENTRE_REPETIDOS = 3;
export const MINUTOS_ENTRE_REINTENTOS = 10;
export const HORA_INICIO_SILENCIO = 21;
export const HORA_FIN_SILENCIO = 7;
const MAX_LINEAS = 3;
const MAX_LINEA = 220;
const MAX_ULTIMOS = 20;
const MAX_TARJETAS_EN_LINEA = 3;
const MS_HORA = 3_600_000;
const BOGOTA_MS = 5 * MS_HORA;

export const TIPOS_DEL_COORDINADOR = ["limite", "necesita"] as const;
export type TipoDeAvisoDelCoordinador = (typeof TIPOS_DEL_COORDINADOR)[number];

export const claveDelTelefono = (workspaceId: string) => `tablero:avisos-dueno:telefono:${workspaceId}`;
export const claveDelInterruptor = (workspaceId: string) => `tablero:avisos-dueno:activo:${workspaceId}`;
export const claveDeLoAvisado = (workspaceId: string) => `tablero:avisos-dueno:anotados:${workspaceId}`;
/** El ajuste viejo (nadie tenía pantalla para llenarlo): sigue valiendo si alguien lo llenó a mano. */
export const claveDelTelefonoViejo = (workspaceId: string) => `trabajador:aviso-telefono:${workspaceId}`;

/* ───────────────────────────────────────────────────────────────────── número y horario ── */

/**
 * El número personal como se guarda: solo dígitos con indicativo. Un celular colombiano de 10 dígitos (300…)
 * recibe el 57. Devuelve null si no parece un número de WhatsApp (menos de 11 o más de 15 dígitos al final).
 */
export function normalizarTelefono(valor: unknown): string | null {
  let digitos = String(valor ?? "").replace(/\D/g, "");
  if (digitos.length === 10 && digitos.startsWith("3")) digitos = `57${digitos}`;
  return digitos.length >= 11 && digitos.length <= 15 ? digitos : null;
}

/** Los últimos 10 dígitos: así 573001234567, 3001234567 y +57 300 123 4567 son el mismo número. */
const cola = (valor: unknown) => String(valor ?? "").replace(/\D/g, "").slice(-10);

/** ¿Este número es de alguno de los prohibidos (asesoras del equipo, líneas del negocio)? */
export function numeroProhibido(numero: string, prohibidos: readonly (string | null | undefined)[]): boolean {
  const mio = cola(numero);
  return mio.length === 10 && prohibidos.some((otro) => cola(otro) === mio);
}

export function horaDeBogota(ahora: Date): number {
  return new Date(ahora.getTime() - BOGOTA_MS).getUTCHours();
}

/** Silencio de 9:00 p. m. a 7:00 a. m. (Bogotá). */
export function enSilencio(ahora: Date): boolean {
  const hora = horaDeBogota(ahora);
  return hora >= HORA_INICIO_SILENCIO || hora < HORA_FIN_SILENCIO;
}

/* ───────────────────────────────────────────────────────────────────── lo ya avisado ── */

export type AvisoAnotado = { cuando: string; tipo: string; texto: string; salio: boolean; motivo: string | null };
export type LoAvisado = { problemas: Record<string, string>; ultimos: AvisoAnotado[] };

export const sinAvisos = (): LoAvisado => ({ problemas: {}, ultimos: [] });

export function leerLoAvisado(valor: string | null | undefined): LoAvisado {
  if (!valor) return sinAvisos();
  try {
    const leido = JSON.parse(valor) as Partial<LoAvisado>;
    const problemas: Record<string, string> = {};
    for (const [clave, cuando] of Object.entries(leido.problemas ?? {})) if (typeof cuando === "string") problemas[clave] = cuando;
    const ultimos = Array.isArray(leido.ultimos)
      ? leido.ultimos.filter((a): a is AvisoAnotado => Boolean(a) && typeof a.cuando === "string" && typeof a.texto === "string").slice(0, MAX_ULTIMOS)
      : [];
    return { problemas, ultimos };
  } catch {
    return sinAvisos();
  }
}

/** ¿Toca avisar de este problema? Si nunca se avisó, o ya pasaron 3 horas desde el último aviso. */
export function tocaAvisar(clave: string, avisado: LoAvisado, ahora: Date): boolean {
  const ultimo = avisado.problemas[clave];
  if (!ultimo) return true;
  const desde = Date.parse(ultimo);
  return !Number.isFinite(desde) || ahora.getTime() - desde >= HORAS_ENTRE_REPETIDOS * MS_HORA;
}

/* ───────────────────────────────────────────────────────────────────── detectar problemas ── */

export type TarjetaParaAvisar = {
  id: string;
  titulo: string;
  estado: string;
  plan: string | null;
  zonaProtegida: readonly string[];
  /** Resultado.error.motivo, si lo hay. */
  motivoDelError: string | null;
  /** Desde cuándo está en este estado (último cambio del historial; el latido no cuenta). */
  desde: Date;
};

export type FotoDelSistema = {
  /** Última vez que el Coordinador usó su clave; null = nunca (o no hay clave): no se avisa. */
  ultimoUsoDelCoordinador: Date | null;
  tarjetas: readonly TarjetaParaAvisar[];
};

export type TipoDeProblema = "coordinador" | "necesita" | "trabado" | "sin_trabajo" | "limite";

export type Problema = { clave: string; tipo: TipoDeProblema; detalle: string; titulo?: string };

const EN_CURSO = ["PLANEANDO", "EN_CURSO", "SUBIENDO"];
const EN_FILA = ["APROBADO", "PLAN_APROBADO"];
const ESPERAN_AL_DUENO = ["POR_APROBAR", "PLAN_LISTO", "POR_REVISAR", "ERROR"];
const ETIQUETA_DEL_ESTADO: Record<string, string> = { PLANEANDO: "planeando", EN_CURSO: "construyendo", SUBIENDO: "subiendo" };
const PEDIDO_DE_ACCESO = /\b(clave|claves|contrase[nñ]a|token|credencial(?:es)?|acceso|permiso|permisos|api[ -]?key|secret|autoriz\w*)\b/i;

const corto = (valor: string, maximo: number) => {
  const limpio = valor.replace(/\s+/g, " ").trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1).trimEnd()}…` : limpio;
};

/** Qué necesita el dueño de una tarjeta que lo espera, en pocas palabras. */
export function queNecesita(estado: string): string {
  if (estado === "POR_APROBAR") return "aprobar la tarea";
  if (estado === "PLAN_LISTO") return "aprobar el plan";
  if (estado === "POR_REVISAR") return "revisar el resultado";
  return "ver el error";
}

/** ¿Esta tarjeta le pide algo al dueño que el sistema no puede hacer solo? Devuelve el motivo corto, o null. */
export function motivoParaElDueno(tarjeta: TarjetaParaAvisar): string | null {
  if (tarjeta.estado === "PLAN_LISTO") {
    if (tarjeta.zonaProtegida.includes("META_ADS")) return "su plan toca Meta Ads";
    const motivo = tarjeta.plan ? porQueElPlanEsperaTuSi(tarjeta.plan) : null;
    if (motivo) return "su plan toca dinero o presupuesto";
  }
  if (tarjeta.estado === "ERROR" && tarjeta.motivoDelError && PEDIDO_DE_ACCESO.test(tarjeta.motivoDelError)) {
    return `falta una clave, acceso o permiso: ${corto(tarjeta.motivoDelError, 120)}`;
  }
  return null;
}

const comillas = (titulo: string) => `«${corto(titulo, 60)}»`;
const horasEntre = (desde: Date, ahora: Date) => Math.max(1, Math.floor((ahora.getTime() - desde.getTime()) / MS_HORA));

/** Los problemas que hay AHORA, con la clave con que se anotan (una por problema) y su línea de texto. */
export function detectarProblemas(foto: FotoDelSistema, ahora: Date): Problema[] {
  const problemas: Problema[] = [];
  const sinSenales =
    foto.ultimoUsoDelCoordinador !== null && ahora.getTime() - foto.ultimoUsoDelCoordinador.getTime() > MINUTOS_SIN_SENALES * 60_000;
  if (sinSenales && foto.ultimoUsoDelCoordinador) {
    const minutos = Math.floor((ahora.getTime() - foto.ultimoUsoDelCoordinador.getTime()) / 60_000);
    const cuanto = minutos >= 120 ? `${Math.floor(minutos / 60)} horas` : `${minutos} minutos`;
    problemas.push({
      clave: "coordinador-caido",
      tipo: "coordinador",
      detalle: `🔴 Sistemas está apagado: el Coordinador (aizen1) no da señales hace ${cuanto}.`,
    });
    // Con el Coordinador caído, lo demás ("trabado", "sin trabajo") es consecuencia: un solo aviso.
    return problemas;
  }

  const propias = foto.tarjetas;
  const paraElDueno = new Set<string>();
  for (const tarjeta of propias) {
    const motivo = motivoParaElDueno(tarjeta);
    if (!motivo) continue;
    paraElDueno.add(tarjeta.id);
    problemas.push({ clave: `necesita:${tarjeta.id}`, tipo: "necesita", titulo: tarjeta.titulo, detalle: `${comillas(tarjeta.titulo)} te necesita: ${motivo}.` });
  }

  for (const tarjeta of propias) {
    if (paraElDueno.has(tarjeta.id)) continue;
    if (EN_CURSO.includes(tarjeta.estado)) {
      if (ahora.getTime() - tarjeta.desde.getTime() > HORAS_ATASCADA * MS_HORA) {
        problemas.push({
          clave: `trabado:${tarjeta.id}`,
          tipo: "trabado",
          titulo: tarjeta.titulo,
          detalle: `${comillas(tarjeta.titulo)} lleva ${horasEntre(tarjeta.desde, ahora)} h ${ETIQUETA_DEL_ESTADO[tarjeta.estado]} sin avanzar.`,
        });
      }
    } else if (tarjeta.estado === "ERROR") {
      problemas.push({
        clave: `trabado:${tarjeta.id}`,
        tipo: "trabado",
        titulo: tarjeta.titulo,
        detalle: `${comillas(tarjeta.titulo)} quedó en error: ${corto(tarjeta.motivoDelError ?? "sin causa escrita", 140)}`,
      });
    }
  }

  const hayTrabajo = propias.some((t) => EN_CURSO.includes(t.estado) || EN_FILA.includes(t.estado));
  const esperan = propias.filter((t) => ESPERAN_AL_DUENO.includes(t.estado));
  if (!hayTrabajo && esperan.length) {
    const lista = esperan.slice(0, MAX_TARJETAS_EN_LINEA).map((t) => `${comillas(t.titulo)} (${queNecesita(t.estado)})`);
    if (esperan.length > lista.length) lista.push(`y ${esperan.length - lista.length} más`);
    problemas.push({ clave: "sin-trabajo", tipo: "sin_trabajo", detalle: `🟡 Sistemas se quedó sin trabajo. Esperan tu decisión: ${lista.join("; ")}.` });
  }
  return problemas;
}

/* ───────────────────────────────────────────────────────────────────── armar el mensaje ── */

const PRIORIDAD: TipoDeProblema[] = ["coordinador", "limite", "necesita", "trabado", "sin_trabajo"];

/** Una línea por grupo de problemas del mismo tipo (las tarjetas se juntan: «A», «B» y 2 más). */
function lineaDelGrupo(tipo: TipoDeProblema, problemas: readonly Problema[]): string {
  if (problemas.length === 1 || tipo === "coordinador" || tipo === "sin_trabajo" || tipo === "limite") return corto(problemas[0].detalle, MAX_LINEA);
  const principal = problemas.slice(0, MAX_TARJETAS_EN_LINEA).map((p) => p.detalle.replace(/\.$/, ""));
  const mas = problemas.length - principal.length;
  const encabezado = tipo === "trabado" ? "🟠 Trabadas" : "🔵 Te necesitan";
  return corto(`${encabezado}: ${principal.join(" | ")}${mas > 0 ? ` | y ${mas} más` : ""}`, MAX_LINEA * 2);
}

export function linkDelTablero(): string {
  const base = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.aizenbot.com").trim().replace(/\/+$/, "");
  return `${base}/cliente/tableros-inteligentes`;
}

/**
 * El mensaje de esta vuelta, de MÁXIMO 3 líneas: hasta dos líneas de problemas (por prioridad) y el link.
 * `incluidos` son los problemas que quedaron dentro: solo esos se anotan como avisados; el resto sale en la próxima vuelta.
 */
export function armarMensaje(problemas: readonly Problema[]): { texto: string; incluidos: Problema[] } | null {
  if (!problemas.length) return null;
  const grupos = PRIORIDAD.map((tipo) => ({ tipo, problemas: problemas.filter((p) => p.tipo === tipo) })).filter((g) => g.problemas.length);
  const elegidos = grupos.slice(0, MAX_LINEAS - 1);
  const lineas = elegidos.map((g) => lineaDelGrupo(g.tipo, g.problemas));
  lineas.push(linkDelTablero());
  return { texto: lineas.join("\n"), incluidos: elegidos.flatMap((g) => g.problemas) };
}

/* ───────────────────────────────────────────────────────────────────── la base ── */

async function leerAjuste(key: string): Promise<string | null> {
  const fila = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
  return fila?.value ?? null;
}

async function guardarAjuste(key: string, value: string) {
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** El interruptor: sin ajuste guardado, PRENDIDO. */
export async function avisosAlDuenoPrendidos(workspaceId: string): Promise<boolean> {
  return (await leerAjuste(claveDelInterruptor(workspaceId))) !== "false";
}

export async function ponerAvisosAlDueno(workspaceId: string, prendidos: boolean) {
  await guardarAjuste(claveDelInterruptor(workspaceId), prendidos ? "true" : "false");
}

/** El número guardado (la caja de Mi empresa) o, si está vacío, el ajuste viejo. null = no hay número válido. */
export async function leerTelefonoDelDueno(workspaceId: string): Promise<string | null> {
  const nuevo = normalizarTelefono(await leerAjuste(claveDelTelefono(workspaceId)));
  if (nuevo) return nuevo;
  return normalizarTelefono(await leerAjuste(claveDelTelefonoViejo(workspaceId)));
}

/** Los números que NO pueden recibir estos avisos: las asesoras del equipo (menos el dueño) y las líneas del negocio. */
async function numerosProhibidos(workspaceId: string): Promise<(string | null)[]> {
  const [negocio, miembros, lineas] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } }),
    prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true, user: { select: { phone: true } } } }),
    prisma.whatsAppChannel.findMany({ where: { workspaceId }, select: { phoneNumber: true } }),
  ]);
  return [
    ...miembros.filter((m) => m.userId !== negocio?.ownerId).map((m) => m.user.phone),
    ...lineas.map((l) => l.phoneNumber),
  ];
}

/** Valida en el servidor un número escrito por el dueño. Devuelve el número normalizado o el motivo del rechazo. */
export async function validarTelefonoDelDueno(workspaceId: string, valor: unknown): Promise<{ ok: true; numero: string } | { ok: false; error: string }> {
  const numero = normalizarTelefono(valor);
  if (!numero) return { ok: false, error: "El número no es válido: escríbelo con indicativo, solo dígitos (p. ej. 573001234567)." };
  if (numeroProhibido(numero, await numerosProhibidos(workspaceId))) {
    return { ok: false, error: "Ese número es de una asesora del equipo o de una línea de WhatsApp del negocio. Pon tu número personal." };
  }
  return { ok: true, numero };
}

export async function guardarTelefonoDelDueno(workspaceId: string, valor: unknown) {
  const validado = await validarTelefonoDelDueno(workspaceId, valor);
  if (validado.ok) await guardarAjuste(claveDelTelefono(workspaceId), validado.numero);
  return validado;
}

/** La línea por la que salen los avisos: la Admin por su id; si no existe, la llamada "Admin". Nunca una de ventas. */
async function lineaAdmin(workspaceId: string) {
  const select = { id: true, name: true, evolutionInstanceName: true } as const;
  const porId = await prisma.whatsAppChannel.findFirst({
    where: { id: LINEA_ADMIN_ID, workspaceId, isActive: true, evolutionInstanceName: { not: null } },
    select,
  });
  if (porId) return porId;
  return prisma.whatsAppChannel.findFirst({
    where: { workspaceId, isActive: true, evolutionInstanceName: { not: null }, name: { equals: "Admin", mode: "insensitive" } },
    select,
  });
}

export async function leerLoAvisadoDelNegocio(workspaceId: string): Promise<LoAvisado> {
  return leerLoAvisado(await leerAjuste(claveDeLoAvisado(workspaceId)));
}

async function anotar(workspaceId: string, avisado: LoAvisado) {
  await guardarAjuste(claveDeLoAvisado(workspaceId), JSON.stringify(avisado));
}

export type ResultadoDelEnvio = { salio: boolean; motivo: string | null };

/**
 * Manda el texto al número del dueño por la línea Admin. Nunca lanza: devuelve si salió y, si no, por qué.
 * El número SIEMPRE sale de lo guardado (nadie puede pasar otro) y se vuelve a validar acá.
 */
export async function enviarAlDueno(workspaceId: string, texto: string): Promise<ResultadoDelEnvio> {
  try {
    const numero = await leerTelefonoDelDueno(workspaceId);
    if (!numero) return { salio: false, motivo: "falta su número en Mi empresa → Claude" };
    if (numeroProhibido(numero, await numerosProhibidos(workspaceId))) {
      return { salio: false, motivo: "el número guardado es de una asesora o de una línea del negocio" };
    }
    const linea = await lineaAdmin(workspaceId);
    if (!linea?.evolutionInstanceName) return { salio: false, motivo: "el negocio no tiene la línea Admin conectada" };
    try {
      await sendEvolutionTextMessageWithReconnect({ instanceName: linea.evolutionInstanceName, phoneNumber: numero, text: texto });
    } catch (error) {
      console.warn("[avisos-al-dueno] no salió el WhatsApp", { error: error instanceof Error ? error.message : String(error) });
      return { salio: false, motivo: "la línea Admin no pudo enviar el mensaje (¿está desconectada?)" };
    }
    return { salio: true, motivo: null };
  } catch (error) {
    return { salio: false, motivo: `falló al enviar: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200) };
  }
}

/** Anota un aviso (salió o no) en la lista de los últimos; si salió, anota también los problemas incluidos. */
function anotarAviso(avisado: LoAvisado, ahora: Date, tipo: string, texto: string, envio: ResultadoDelEnvio, claves: readonly string[]) {
  avisado.ultimos = [{ cuando: ahora.toISOString(), tipo, texto: texto.slice(0, 600), salio: envio.salio, motivo: envio.motivo }, ...avisado.ultimos].slice(0, MAX_ULTIMOS);
  // Solo lo que salió cuenta como avisado: si no salió (falta el número, la línea está caída), se reintenta más adelante.
  if (envio.salio) for (const clave of claves) avisado.problemas[clave] = ahora.toISOString();
}

/** Lo que hay que hacer con los problemas de una vuelta (puro, para probarlo sin base). */
export function problemasPorAvisar(problemas: readonly Problema[], avisado: LoAvisado, ahora: Date): Problema[] {
  const caido = problemas.some((p) => p.tipo === "coordinador");
  return problemas.filter((p) => tocaAvisar(p.clave, avisado, ahora) && (!enSilencio(ahora) || (caido && p.tipo === "coordinador")));
}

/**
 * Quita lo anotado de problemas que ya no existen: si vuelven, es un problema nuevo y se avisa de nuevo. Los avisos
 * que manda el Coordinador (límite, necesita) no se detectan acá: se vencen solos a las 3 horas.
 */
export function olvidarResueltos(avisado: LoAvisado, problemas: readonly Problema[], ahora: Date): boolean {
  const vigentes = new Set(problemas.map((p) => p.clave));
  let cambio = false;
  for (const clave of Object.keys(avisado.problemas)) {
    const delCoordinador = clave.startsWith("limite:") || clave.startsWith("necesita-coordinador:");
    if (delCoordinador ? tocaAvisar(clave, avisado, ahora) : !vigentes.has(clave)) {
      delete avisado.problemas[clave];
      cambio = true;
    }
  }
  return cambio;
}

/** Si el último intento no salió, se espera unos minutos antes de volver a intentar (no llenar la lista cada minuto). */
export function esperandoReintento(avisado: LoAvisado, ahora: Date): boolean {
  const ultimo = avisado.ultimos[0];
  if (!ultimo || ultimo.salio || ultimo.tipo === "prueba") return false;
  return ahora.getTime() - Date.parse(ultimo.cuando) < MINUTOS_ENTRE_REINTENTOS * 60_000;
}

async function fotoDelSistema(workspaceId: string): Promise<FotoDelSistema> {
  const [claves, tarjetas] = await Promise.all([
    prisma.claveTrabajador.findMany({ where: { workspaceId, revocadaEn: null }, select: { ultimoUsoEn: true } }),
    prisma.tarjetaTablero.findMany({
      where: {
        tablero: { workspaceId },
        borradoEn: null,
        repo: { not: null },
        estado: { in: [...EN_CURSO, ...EN_FILA, ...ESPERAN_AL_DUENO] as EstadoTarjeta[] },
      },
      select: {
        id: true,
        titulo: true,
        estado: true,
        plan: true,
        zonaProtegida: true,
        resultado: true,
        trabajoIniciadoEn: true,
        actualizadoEn: true,
        historial: { orderBy: { creadoEn: "desc" }, take: 1, select: { creadoEn: true } },
      },
      take: 200,
    }),
  ]);
  const usos = claves.map((c) => c.ultimoUsoEn).filter((u): u is Date => u instanceof Date);
  return {
    ultimoUsoDelCoordinador: usos.length ? new Date(Math.max(...usos.map((u) => u.getTime()))) : null,
    tarjetas: tarjetas.map((t) => {
      const resultado = t.resultado && typeof t.resultado === "object" && !Array.isArray(t.resultado) ? (t.resultado as Record<string, unknown>) : {};
      const error = resultado.error && typeof resultado.error === "object" ? (resultado.error as Record<string, unknown>) : {};
      return {
        id: t.id,
        titulo: t.titulo,
        estado: t.estado,
        plan: t.plan,
        zonaProtegida: t.zonaProtegida,
        motivoDelError: typeof error.motivo === "string" && error.motivo.trim() ? error.motivo.trim() : null,
        desde: t.historial[0]?.creadoEn ?? t.trabajoIniciadoEn ?? t.actualizadoEn,
      };
    }),
  };
}

/**
 * Una vuelta para un negocio: mira el sistema y, si hay algo nuevo que decir y no es hora de silencio, manda UN
 * mensaje. Devuelve cuántos mensajes salieron (0 o 1).
 */
export async function revisarNegocio(workspaceId: string, ahora = new Date()): Promise<number> {
  if (!(await avisosAlDuenoPrendidos(workspaceId))) return 0;
  const problemas = detectarProblemas(await fotoDelSistema(workspaceId), ahora);
  const avisado = await leerLoAvisadoDelNegocio(workspaceId);
  const olvidado = olvidarResueltos(avisado, problemas, ahora);
  const nuevos = problemasPorAvisar(problemas, avisado, ahora);
  const mensaje = armarMensaje(nuevos);
  if (!mensaje || esperandoReintento(avisado, ahora)) {
    if (olvidado) await anotar(workspaceId, avisado);
    return 0;
  }
  const envio = await enviarAlDueno(workspaceId, mensaje.texto);
  const tipo = mensaje.incluidos[0]?.tipo ?? "aviso";
  anotarAviso(avisado, ahora, tipo, mensaje.texto, envio, mensaje.incluidos.map((p) => p.clave));
  await anotar(workspaceId, avisado);
  return envio.salio ? 1 : 0;
}

/** La vuelta del reloj (cada minuto): todos los negocios que tienen una clave del Coordinador. Nunca lanza. */
export async function revisarAvisosAlDueno(ahora = new Date()): Promise<{ enviados: number }> {
  const negocios = await prisma.claveTrabajador.findMany({ where: { revocadaEn: null }, distinct: ["workspaceId"], select: { workspaceId: true } });
  let enviados = 0;
  for (const { workspaceId } of negocios) {
    try {
      enviados += await revisarNegocio(workspaceId, ahora);
    } catch (error) {
      console.error("[avisos-al-dueno] falló la revisión", { workspaceId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { enviados };
}

/* ───────────────────────────────────────────────────────────────────── lo que manda el Coordinador ── */

export type RespuestaDelAviso = { ok: true; enviado: boolean; motivo: string | null };

/** Clave de "una vez por problema" de un aviso que manda el Coordinador. */
export function claveDelAvisoDelCoordinador(tipo: TipoDeAvisoDelCoordinador, texto: string): string {
  if (tipo === "limite") return "limite:claude";
  let hash = 0;
  for (const letra of texto.toLowerCase().replace(/\d+/g, "#")) hash = (hash * 31 + letra.charCodeAt(0)) >>> 0;
  return `necesita-coordinador:${hash.toString(36)}`;
}

/**
 * Un aviso que manda el Coordinador (POST /api/trabajador/aviso con tipo "limite" o "necesita"). Mismas reglas:
 * interruptor, silencio nocturno, uno por problema cada 3 horas, máximo 3 líneas con link. Sin número no es un
 * error: queda anotado "no salió: falta su número en Mi empresa → Claude".
 */
export async function avisoDelCoordinador(workspaceId: string, tipo: TipoDeAvisoDelCoordinador, texto: string, ahora = new Date()): Promise<RespuestaDelAviso> {
  if (!(await avisosAlDuenoPrendidos(workspaceId))) return { ok: true, enviado: false, motivo: "los avisos al dueño están apagados" };
  const avisado = await leerLoAvisadoDelNegocio(workspaceId);
  const clave = claveDelAvisoDelCoordinador(tipo, texto);
  if (enSilencio(ahora)) return { ok: true, enviado: false, motivo: "silencio de 9:00 p. m. a 7:00 a. m." };
  if (!tocaAvisar(clave, avisado, ahora)) return { ok: true, enviado: false, motivo: "ya se avisó de esto hace menos de 3 horas" };
  const lineas = texto.split("\n").map((l) => corto(l, MAX_LINEA)).filter(Boolean).slice(0, MAX_LINEAS - 1);
  const mensaje = [...lineas, linkDelTablero()].join("\n");
  const envio = await enviarAlDueno(workspaceId, mensaje);
  anotarAviso(avisado, ahora, tipo, mensaje, envio, [clave]);
  await anotar(workspaceId, avisado);
  return { ok: true, enviado: envio.salio, motivo: envio.motivo ? `no salió: ${envio.motivo}` : null };
}

/** El mensaje de prueba del botón "Mandar prueba" (no cuenta como problema ni respeta el silencio: lo pide el dueño). */
export async function mandarPrueba(workspaceId: string, ahora = new Date()): Promise<ResultadoDelEnvio> {
  const mensaje = ["✅ Prueba: así te va a avisar Sistemas cuando se detenga o te necesite.", linkDelTablero()].join("\n");
  const envio = await enviarAlDueno(workspaceId, mensaje);
  const avisado = await leerLoAvisadoDelNegocio(workspaceId);
  anotarAviso(avisado, ahora, "prueba", mensaje, envio, []);
  await anotar(workspaceId, avisado);
  return envio;
}

/** Lo que muestra la caja de Mi empresa → Claude. */
export async function avisosParaLaPantalla(workspaceId: string) {
  const [telefono, prendidos, avisado] = await Promise.all([leerTelefonoDelDueno(workspaceId), avisosAlDuenoPrendidos(workspaceId), leerLoAvisadoDelNegocio(workspaceId)]);
  return { telefono, prendidos, ultimos: avisado.ultimos };
}
