import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";

import { ultimoLatido } from "./coordinador-en-vivo";
import { porQueElPlanEsperaTuSi, porQueLaTareaEsperaTuSi } from "./reglas-riesgo";
import { zonasQueNoArrancanSolas } from "./reglas-trabajador";
import { tituloCorto } from "./resumen-corto";
import { linkDeHoy, linkDeLaTarjeta, linkDelCoordinador, pendientesDelDueno, todoElNegocio } from "./tableros";

/*
  AVISOS AL DUEÑO por WhatsApp (26-oct-2026). Decisión del dueño: "solo cuando sea algo realmente súper
  importante; lo que están desarrollando lo puedo mirar en el tablero". Ni "empezó", ni "terminó", ni
  resúmenes ni avances. Solo estos 5 casos, en un mensaje de MÁXIMO 3 LÍNEAS con link:
    1. caido       el Coordinador no da señales hace más de 10 minutos (aizen1 apagado, proceso caído, sin internet).
    2. sin_trabajo nada en curso ni en fila y hay tarjetas esperando al dueño (dice cuáles y qué necesitan).
    3. trabado     una tarjeta lleva más de 2 horas planeando, construyendo o subiendo sin cambiar de estado, o
                   quedó en ERROR (el Coordinador ya gastó sus 3 reparaciones): dice la causa en una línea.
    4. necesita    espera al dueño y toca Meta Ads, dinero o presupuesto, o su error pide una clave o un permiso.
                   También lo puede mandar el Coordinador por /api/trabajador/aviso con tipo "necesita".
    5. limite      Claude se agotó y todo quedó en pausa: lo manda el Coordinador (tipo "limite") con la hora de vuelta.

  Reglas: sale SOLO desde la línea Admin (id fijo; si no existe, la llamada "Admin") y SOLO al número personal del
  dueño guardado en Mi empresa → Claude, validado acá (no puede ser el de una asesora ni el de una línea del
  negocio); nadie puede pasar otro número. Un solo aviso por problema: se repite solo si sigue igual después de 3
  horas. Silencio de 9:00 p. m. a 7:00 a. m. (Bogotá), salvo "caido". Interruptor: empieza prendido.

  Todo se guarda en AppSetting (sin tablas nuevas). El reloj del servidor (api/cron/follows) llama a
  revisarAvisosAlDueno cada minuto. Antes de este archivo el aviso del Coordinador devolvía 412 porque nadie
  guardaba el número en ninguna pantalla.
*/

export const LINEA_ADMIN_ID = "cmt06kiob00lw2hk2mgllstsb";

export const claveTelefonoDelDueno = (workspaceId: string) => `tablero:avisos-dueno:telefono:${workspaceId}`;
export const claveInterruptorDeAvisos = (workspaceId: string) => `tablero:avisos-dueno:activo:${workspaceId}`;
export const claveEstadoDeAvisos = (workspaceId: string) => `tablero:avisos-dueno:estado:${workspaceId}`;
/** El ajuste que usaba el aviso del Coordinador antes de que existiera la caja de Mi empresa. */
const claveTelefonoViejo = (workspaceId: string) => `trabajador:aviso-telefono:${workspaceId}`;

export const TIPOS_DE_AVISO = ["caido", "sin_trabajo", "trabado", "necesita", "limite"] as const;
export type TipoDeAviso = (typeof TIPOS_DE_AVISO)[number];

/** Lo que puede mandar el Coordinador (los otros tres los calcula el servidor). */
export const TIPOS_DEL_COORDINADOR: readonly TipoDeAviso[] = ["limite", "necesita"];

const MS_MINUTO = 60_000;
const MS_HORA = 3_600_000;
const MINUTOS_PARA_DAR_POR_CAIDO = 10;
const HORAS_PARA_DAR_POR_TRABADA = 2;
const HORAS_PARA_REPETIR = 3;
const MAXIMO_LINEAS = 3;
const MAXIMO_HISTORIAL = 20;
const BOGOTA_MS = 5 * MS_HORA;
const MAXIMO_TITULOS = 3;

/** ¿Es hora de silencio (9:00 p. m. a 6:59 a. m. de Bogotá, UTC-5 todo el año)? */
export function enSilencioDeAvisos(ahora: Date = new Date()): boolean {
  const hora = new Date(ahora.getTime() - BOGOTA_MS).getUTCHours();
  return hora >= 21 || hora < 7;
}

/* ───────────────────────────────────────────────────────────────────── el número ── */

/** Solo dígitos con indicativo: 10 dígitos que empiezan por 3 son de Colombia y se les pone el 57. Null si no sirve. */
export function normalizarTelefono(valor: unknown): string | null {
  let digitos = String(valor ?? "").replace(/\D/g, "");
  if (digitos.length === 10 && digitos.startsWith("3")) digitos = `57${digitos}`;
  return digitos.length >= 11 && digitos.length <= 15 ? digitos : null;
}

const igualNumero = (a: string | null | undefined, b: string | null | undefined) => {
  const x = String(a ?? "").replace(/\D/g, "");
  const y = String(b ?? "").replace(/\D/g, "");
  return Boolean(x && y) && (x === y || (x.length >= 10 && y.length >= 10 && x.slice(-10) === y.slice(-10)));
};

/** Los números que NO pueden ser el del dueño: las líneas de WhatsApp del negocio y las asesoras del equipo. */
async function numerosProhibidos(workspaceId: string): Promise<{ numero: string; de: string }[]> {
  const [lineas, miembros, avisos] = await Promise.all([
    prisma.whatsAppChannel.findMany({ where: { workspaceId }, select: { name: true, phoneNumber: true } }),
    prisma.workspaceMember.findMany({
      where: { workspaceId, isActive: true, role: { notIn: ["OWNER", "ADMIN"] } },
      select: { user: { select: { name: true, phone: true } } },
    }),
    prisma.appSetting.findUnique({ where: { key: `agente-v3:avisos:${workspaceId}` }, select: { value: true } }),
  ]);
  const prohibidos: { numero: string; de: string }[] = [];
  for (const linea of lineas) if (linea.phoneNumber) prohibidos.push({ numero: linea.phoneNumber, de: `la línea "${linea.name}"` });
  for (const miembro of miembros) if (miembro.user?.phone) prohibidos.push({ numero: miembro.user.phone, de: `${miembro.user.name ?? "una asesora"} del equipo` });
  try {
    const destinos = (JSON.parse(avisos?.value ?? "{}") as { destinos?: { numero?: string; soloDe?: string | null }[] }).destinos ?? [];
    // Las que tienen `soloDe` son asesoras (solo ven lo suyo); la del administrador no.
    for (const destino of destinos) if (destino.numero && destino.soloDe) prohibidos.push({ numero: destino.numero, de: "una asesora del equipo" });
  } catch {
    // Ajuste ilegible: no se usa.
  }
  return prohibidos;
}

/** Valida el número del dueño en el servidor. Devuelve el número limpio o el motivo del rechazo. */
export async function validarTelefonoDelDueno(workspaceId: string, valor: unknown): Promise<{ ok: true; numero: string } | { ok: false; error: string }> {
  const numero = normalizarTelefono(valor);
  if (!numero) return { ok: false, error: "El número no sirve: escríbalo solo con dígitos y con indicativo (por ejemplo 573001234567)." };
  const choque = (await numerosProhibidos(workspaceId)).find((otro) => igualNumero(otro.numero, numero));
  if (choque) return { ok: false, error: `Ese número es de ${choque.de}: tiene que ser su número personal.` };
  return { ok: true, numero };
}

/* ───────────────────────────────────────────────────────────────────── los ajustes ── */

export async function avisosPrendidos(workspaceId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveInterruptorDeAvisos(workspaceId) }, select: { value: true } });
  return fila?.value !== "false";
}

/** El número guardado (el de la caja de Mi empresa o, si no hay, el ajuste viejo), sin validar. */
export async function telefonoGuardado(workspaceId: string): Promise<string | null> {
  for (const key of [claveTelefonoDelDueno(workspaceId), claveTelefonoViejo(workspaceId)]) {
    const fila = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
    const numero = normalizarTelefono(fila?.value);
    if (numero) return numero;
  }
  return null;
}

async function guardarAjuste(key: string, value: string) {
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function guardarConfigDeAvisos(workspaceId: string, cambios: { telefono?: string; activo?: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (cambios.telefono !== undefined) {
    if (!String(cambios.telefono).trim()) {
      await guardarAjuste(claveTelefonoDelDueno(workspaceId), "");
    } else {
      const validado = await validarTelefonoDelDueno(workspaceId, cambios.telefono);
      if (!validado.ok) return validado;
      await guardarAjuste(claveTelefonoDelDueno(workspaceId), validado.numero);
    }
  }
  if (cambios.activo !== undefined) await guardarAjuste(claveInterruptorDeAvisos(workspaceId), cambios.activo ? "true" : "false");
  return { ok: true };
}

/* ───────────────────────────────────────────────────────────────────── lo ya avisado ── */

export type AvisoAnotado = { cuando: string; tipo: string; texto: string; salio: boolean; motivo: string | null };
type EstadoDeAvisos = { avisados: Record<string, string>; historial: AvisoAnotado[] };

export async function leerEstadoDeAvisos(workspaceId: string): Promise<EstadoDeAvisos> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveEstadoDeAvisos(workspaceId) }, select: { value: true } });
  try {
    const leido = JSON.parse(fila?.value ?? "{}") as Partial<EstadoDeAvisos>;
    return {
      avisados: leido.avisados && typeof leido.avisados === "object" ? leido.avisados : {},
      historial: Array.isArray(leido.historial) ? leido.historial.slice(0, MAXIMO_HISTORIAL) : [],
    };
  } catch {
    return { avisados: {}, historial: [] };
  }
}

async function guardarEstadoDeAvisos(workspaceId: string, estado: EstadoDeAvisos) {
  await guardarAjuste(claveEstadoDeAvisos(workspaceId), JSON.stringify({ ...estado, historial: estado.historial.slice(0, MAXIMO_HISTORIAL) }));
}

/** ¿Ya se avisó de este problema hace menos de 3 horas? */
export function yaSeAvisoDe(estado: Pick<EstadoDeAvisos, "avisados">, clave: string, ahora: Date): boolean {
  const antes = Date.parse(estado.avisados[clave] ?? "");
  return Number.isFinite(antes) && ahora.getTime() - antes < HORAS_PARA_REPETIR * MS_HORA;
}

/** Anota en el historial; un mismo fallo seguido se anota una vez cada 3 horas, para no llenar la caja. */
function anotarEnHistorial(estado: EstadoDeAvisos, nuevo: AvisoAnotado) {
  const ultimo = estado.historial[0];
  const repetido = !nuevo.salio && ultimo && !ultimo.salio && ultimo.motivo === nuevo.motivo && Date.parse(nuevo.cuando) - Date.parse(ultimo.cuando) < HORAS_PARA_REPETIR * MS_HORA;
  if (!repetido) estado.historial.unshift(nuevo);
}

/* ───────────────────────────────────────────────────────────────────── el envío ── */

async function lineaAdmin(workspaceId: string) {
  const porId = await prisma.whatsAppChannel.findFirst({
    where: { id: LINEA_ADMIN_ID, workspaceId, isActive: true, evolutionInstanceName: { not: null } },
    select: { name: true, evolutionInstanceName: true },
  });
  if (porId?.evolutionInstanceName) return { name: porId.name, instancia: porId.evolutionInstanceName };
  const porNombre = await prisma.whatsAppChannel.findFirst({
    where: { workspaceId, isActive: true, evolutionInstanceName: { not: null }, name: { equals: "Admin", mode: "insensitive" } },
    select: { name: true, evolutionInstanceName: true },
  });
  return porNombre?.evolutionInstanceName ? { name: porNombre.name, instancia: porNombre.evolutionInstanceName } : null;
}

/** El texto recortado a las primeras 3 líneas con contenido. */
export function aTresLineas(texto: string): string {
  return texto
    .split("\n")
    .map((linea) => linea.trimEnd())
    .filter((linea) => linea.trim())
    .slice(0, MAXIMO_LINEAS)
    .join("\n");
}

export type ResultadoDelEnvio = { salio: boolean; motivo: string | null; linea?: string; numero?: string };

/**
 * Manda el texto al dueño desde la línea Admin. El destino SOLO sale de lo guardado (validado otra vez acá).
 * Nunca lanza: devuelve por qué no salió. No mira el silencio ni el interruptor (eso es de quien llama).
 */
export async function enviarAlDueno(workspaceId: string, texto: string): Promise<ResultadoDelEnvio> {
  const guardado = await telefonoGuardado(workspaceId);
  if (!guardado) return { salio: false, motivo: "falta su número en Mi empresa → Claude" };
  const validado = await validarTelefonoDelDueno(workspaceId, guardado);
  if (!validado.ok) return { salio: false, motivo: validado.error };
  const linea = await lineaAdmin(workspaceId);
  if (!linea) return { salio: false, motivo: 'no hay línea Admin conectada (ni la fija ni una llamada "Admin")' };
  try {
    await sendEvolutionTextMessageWithReconnect({ instanceName: linea.instancia, phoneNumber: validado.numero, text: aTresLineas(texto) });
    return { salio: true, motivo: null, linea: linea.name, numero: `…${validado.numero.slice(-4)}` };
  } catch (error) {
    console.warn("[avisos-al-dueno] no salió el WhatsApp", { numero: `…${validado.numero.slice(-4)}`, error: error instanceof Error ? error.message : String(error) });
    return { salio: false, motivo: "la línea Admin no pudo enviar el mensaje (¿está desconectada?)" };
  }
}

/* ───────────────────────────────────────────────────────────────────── las reglas (puras) ── */

export type TarjetaActiva = { id: string; titulo: string; estado: string; desde: Date };
export type TarjetaEsperando = {
  id: string;
  titulo: string;
  detalle: string;
  estado: string;
  plan: string | null;
  zonaProtegida: string[];
  error: string | null;
};
export type SituacionDeSistemas = {
  /** Cuándo el CRM recibió el último latido del Coordinador (null = nunca ha dado señales). */
  latidoEn: string | null;
  /** Planeando, construyendo o subiendo (solo las del Coordinador, con repo), con el momento de su último cambio de estado. */
  enCurso: TarjetaActiva[];
  /** Aprobadas esperando turno. */
  enFila: number;
  /** Las que esperan una decisión del dueño. */
  esperando: TarjetaEsperando[];
};

export type AvisoCalculado = { clave: string; tipo: TipoDeAviso; lineas: string[]; link: string };

const QUE_NECESITA: Record<string, string> = {
  POR_APROBAR: "aprobar la tarea",
  PLAN_LISTO: "aprobar el plan",
  POR_REVISAR: "revisar el resultado",
  ERROR: "ver el error",
  FALLIDO: "ver el error",
};
const ESTADO_EN_CURSO: Record<string, string> = { PLANEANDO: "planeando", EN_CURSO: "construyendo", SUBIENDO: "subiendo" };

const unaLinea = (valor: string, maximo: number) => {
  const limpio = valor.replace(/\s+/g, " ").trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1).trimEnd()}…` : limpio;
};
const entreComillas = (titulo: string) => `"${tituloCorto(titulo)}"`;

const PIDE_CLAVE_O_ACCESO = /\b(clave|claves|token|tokens|credencial\w*|contrase\w+|api ?key|secret\w*|acceso|permiso\w*|autoriza\w*|401|403)\b/i;

/** ¿Por qué esta tarjeta necesita al dueño de verdad (dinero, Meta Ads, una clave)? Null si no. */
export function porQueNecesitaAlDueno(tarjeta: TarjetaEsperando): string | null {
  if (tarjeta.estado === "ERROR" || tarjeta.estado === "FALLIDO") {
    return tarjeta.error && PIDE_CLAVE_O_ACCESO.test(tarjeta.error) ? "falta una clave, un acceso o un permiso" : null;
  }
  if (tarjeta.zonaProtegida.includes("META_ADS")) return "toca Meta Ads";
  if (tarjeta.estado === "PLAN_LISTO" && tarjeta.plan) return porQueElPlanEsperaTuSi(tarjeta.plan);
  if (tarjeta.estado === "POR_APROBAR") {
    return porQueLaTareaEsperaTuSi({
      titulo: tarjeta.titulo,
      detalle: tarjeta.detalle,
      zonaProtegida: tarjeta.zonaProtegida,
      zonasQueEsperan: zonasQueNoArrancanSolas(tarjeta.zonaProtegida),
    });
  }
  return null;
}

const lista = (tarjetas: { titulo: string; estado: string }[]) => {
  const dichas = tarjetas.slice(0, MAXIMO_TITULOS).map((t) => `${entreComillas(t.titulo)} (${QUE_NECESITA[t.estado] ?? "decidir"})`);
  const resto = tarjetas.length - dichas.length;
  return resto > 0 ? `${dichas.join(", ")} y ${resto} más` : dichas.join(", ");
};

/** Los avisos que hoy corresponden (sin mirar lo ya avisado, el silencio ni el interruptor). */
export function calcularAvisos(situacion: SituacionDeSistemas, ahora: Date): AvisoCalculado[] {
  const avisos: AvisoCalculado[] = [];

  // 1. Coordinador caído: sin señales hace más de 10 minutos. Si nunca dio señales, no hay Coordinador que vigilar.
  const ultimo = Date.parse(situacion.latidoEn ?? "");
  const minutosSinSenales = Number.isFinite(ultimo) ? Math.floor((ahora.getTime() - ultimo) / MS_MINUTO) : null;
  const caido = minutosSinSenales !== null && minutosSinSenales > MINUTOS_PARA_DAR_POR_CAIDO;
  if (caido) {
    avisos.push({
      clave: "auto:caido",
      tipo: "caido",
      lineas: [`🔴 Sistemas está detenido: el Coordinador no da señales hace ${minutosSinSenales} min.`, "Puede ser aizen1 apagado, el proceso caído o sin internet."],
      link: linkDelCoordinador(),
    });
  }

  // 3. Trabada: más de 2 horas en el mismo estado, o en ERROR (después de las reparaciones).
  const trabadas = new Set<string>();
  for (const tarjeta of situacion.enCurso) {
    const horas = (ahora.getTime() - tarjeta.desde.getTime()) / MS_HORA;
    if (horas < HORAS_PARA_DAR_POR_TRABADA || caido) continue;
    trabadas.add(tarjeta.id);
    avisos.push({
      clave: `auto:trabado:${tarjeta.id}:${tarjeta.estado}`,
      tipo: "trabado",
      lineas: [`⚠️ ${entreComillas(tarjeta.titulo)} lleva ${Math.floor(horas)} h ${ESTADO_EN_CURSO[tarjeta.estado] ?? "sin avanzar"} sin avanzar.`],
      link: linkDeLaTarjeta(tarjeta.id),
    });
  }

  // 4. Necesita al dueño (dinero, Meta Ads, una clave).
  const necesitan = situacion.esperando.map((tarjeta) => ({ tarjeta, motivo: porQueNecesitaAlDueno(tarjeta) })).filter((x) => x.motivo !== null);
  const conCausaPropia = new Set(necesitan.map((x) => x.tarjeta.id));

  for (const tarjeta of situacion.esperando) {
    if ((tarjeta.estado !== "ERROR" && tarjeta.estado !== "FALLIDO") || conCausaPropia.has(tarjeta.id)) continue;
    avisos.push({
      clave: `auto:trabado:${tarjeta.id}:${tarjeta.estado}`,
      tipo: "trabado",
      lineas: [`⚠️ ${entreComillas(tarjeta.titulo)} quedó en error después de los reintentos.`, `Causa: ${unaLinea(tarjeta.error ?? "sin causa escrita", 120)}`],
      link: linkDeLaTarjeta(tarjeta.id),
    });
  }

  // 2. Sin trabajo: nada en curso ni en fila y hay tarjetas esperando al dueño (si el Coordinador está caído, el aviso es el 1).
  const sinTrabajo = !caido && minutosSinSenales !== null && situacion.enCurso.length === 0 && situacion.enFila === 0 && situacion.esperando.length > 0;
  if (sinTrabajo) {
    avisos.push({
      clave: "auto:sin_trabajo",
      tipo: "sin_trabajo",
      lineas: ["⏸️ Sistemas se quedó sin trabajo: nada en curso ni en fila.", `Esperan tu decisión: ${lista(situacion.esperando)}`],
      link: linkDeHoy(),
    });
  }

  // Si ya avisa "sin trabajo", las mismas tarjetas no se avisan otra vez como "necesita".
  if (!sinTrabajo) {
    for (const { tarjeta, motivo } of necesitan) {
      avisos.push({
        clave: `auto:necesita:${tarjeta.id}:${tarjeta.estado}`,
        tipo: "necesita",
        lineas: [`👆 ${entreComillas(tarjeta.titulo)} necesita tu decisión (${QUE_NECESITA[tarjeta.estado] ?? "decidir"}).`, `Motivo: ${unaLinea(motivo ?? "", 120)}`],
        link: linkDeLaTarjeta(tarjeta.id),
      });
    }
  }
  return avisos;
}

/**
 * Junta los avisos de una vuelta en UN mensaje de máximo 3 líneas con el link. Uno solo: sus líneas + link.
 * Varios: una línea por aviso (hasta 2; si hay más, la segunda dice "y N más") + el link del tablero de hoy.
 */
export function armarMensaje(avisos: readonly AvisoCalculado[]): string {
  if (!avisos.length) return "";
  if (avisos.length === 1) return aTresLineas([...avisos[0].lineas.slice(0, MAXIMO_LINEAS - 1), `Ver: ${avisos[0].link}`].join("\n"));
  const primeras = avisos.slice(0, 2).map((aviso) => aviso.lineas[0]);
  if (avisos.length > 2) primeras[1] = `y ${avisos.length - 1} avisos más de Sistemas.`;
  return aTresLineas([...primeras, `Ver: ${linkDeHoy()}`].join("\n"));
}

/* ───────────────────────────────────────────────────────────────────── la base ── */

const ESTADOS_EN_CURSO = ["PLANEANDO", "EN_CURSO", "SUBIENDO"] as const;
const ESTADOS_EN_FILA = ["APROBADO", "PLAN_APROBADO"] as const;

function textoDelError(resultado: unknown): string | null {
  if (!resultado || typeof resultado !== "object" || Array.isArray(resultado)) return null;
  const { error, resumen } = resultado as { error?: unknown; resumen?: unknown };
  for (const valor of [error, resumen]) if (typeof valor === "string" && valor.trim()) return valor.trim();
  return null;
}

export async function leerSituacion(workspaceId: string): Promise<SituacionDeSistemas> {
  const alcance = { borradoEn: null, tablero: { workspaceId } };
  const [latido, enCursoFilas, enFila, pendientes] = await Promise.all([
    ultimoLatido(workspaceId),
    prisma.tarjetaTablero.findMany({
      // Solo las que ejecuta el Coordinador (con repo): una tarea humana que alguien dejó en EN_CURSO a mano no es
      // trabajo de Sistemas y no debe avisar "trabado" (26-oct-2026: "Revisar mejoras del Agente SEO", de Emanuel).
      where: { ...alcance, repo: { not: null }, estado: { in: [...ESTADOS_EN_CURSO] } },
      select: { id: true, titulo: true, estado: true, trabajoIniciadoEn: true, creadoEn: true },
    }),
    prisma.tarjetaTablero.count({ where: { ...alcance, repo: { not: null }, estado: { in: [...ESTADOS_EN_FILA] } } }),
    pendientesDelDueno(todoElNegocio(workspaceId)),
  ]);
  // El latido NO cuenta como avance: se mide con el último cambio del historial, no con actualizadoEn.
  const ultimos = enCursoFilas.length
    ? await prisma.historialTarjeta.groupBy({ by: ["tarjetaId"], where: { tarjetaId: { in: enCursoFilas.map((fila) => fila.id) } }, _max: { creadoEn: true } })
    : [];
  const porTarjeta = new Map(ultimos.map((fila) => [fila.tarjetaId, fila._max.creadoEn]));
  const pendientesFilas = pendientes.filter((p) => ["POR_APROBAR", "PLAN_LISTO", "POR_REVISAR", "ERROR", "FALLIDO"].includes(p.estado));
  return {
    latidoEn: latido?.recibidoEn ?? null,
    enCurso: enCursoFilas.map((fila) => ({
      id: fila.id,
      titulo: fila.titulo,
      estado: fila.estado,
      desde: porTarjeta.get(fila.id) ?? fila.trabajoIniciadoEn ?? fila.creadoEn,
    })),
    enFila,
    esperando: pendientesFilas.map((p) => ({
      id: p.id,
      titulo: p.titulo,
      detalle: p.detalle,
      estado: p.estado,
      plan: p.plan,
      zonaProtegida: p.zonaProtegida,
      error: textoDelError(p.resultado),
    })),
  };
}

/** La revisión de un negocio. Devuelve lo que mandó. */
export async function revisarNegocio(workspaceId: string, ahora: Date): Promise<{ enviados: number }> {
  if (!(await avisosPrendidos(workspaceId))) return { enviados: 0 };
  const [situacion, estado] = await Promise.all([leerSituacion(workspaceId), leerEstadoDeAvisos(workspaceId)]);
  const calculados = calcularAvisos(situacion, ahora);

  // Un problema que ya no existe se olvida (si vuelve, se avisa de nuevo); lo del Coordinador (`coord:`) vence a las 24 horas.
  const vigentes = new Set(calculados.map((aviso) => aviso.clave));
  let cambio = false;
  for (const [clave, cuando] of Object.entries(estado.avisados)) {
    const viejo = !(ahora.getTime() - Date.parse(cuando) < 24 * MS_HORA);
    if ((clave.startsWith("auto:") && !vigentes.has(clave)) || (clave.startsWith("coord:") && viejo)) {
      delete estado.avisados[clave];
      cambio = true;
    }
  }

  let porAvisar = calculados.filter((aviso) => !yaSeAvisoDe(estado, aviso.clave, ahora));
  // Silencio de 9 p. m. a 7 a. m.: solo "Coordinador caído"; lo demás sale a las 7 a. m. si sigue igual.
  if (enSilencioDeAvisos(ahora)) porAvisar = porAvisar.filter((aviso) => aviso.tipo === "caido");
  if (!porAvisar.length) {
    if (cambio) await guardarEstadoDeAvisos(workspaceId, estado);
    return { enviados: 0 };
  }

  const texto = armarMensaje(porAvisar);
  const envio = await enviarAlDueno(workspaceId, texto);
  if (envio.salio) for (const aviso of porAvisar) estado.avisados[aviso.clave] = ahora.toISOString();
  anotarEnHistorial(estado, {
    cuando: ahora.toISOString(),
    tipo: porAvisar.map((aviso) => aviso.tipo).join("+"),
    texto,
    salio: envio.salio,
    motivo: envio.salio ? null : `no salió: ${envio.motivo}`,
  });
  await guardarEstadoDeAvisos(workspaceId, estado);
  return { enviados: envio.salio ? 1 : 0 };
}

/** La vuelta del reloj (cada minuto): revisa cada negocio con tableros. Nunca lanza por un negocio. */
export async function revisarAvisosAlDueno(ahora = new Date()): Promise<{ enviados: number }> {
  const negocios = await prisma.tableroInteligente.findMany({ distinct: ["workspaceId"], select: { workspaceId: true } });
  let enviados = 0;
  for (const { workspaceId } of negocios) {
    try {
      enviados += (await revisarNegocio(workspaceId, ahora)).enviados;
    } catch (error) {
      console.error("[avisos-al-dueno] no se pudo revisar el negocio", { workspaceId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { enviados };
}

/**
 * Un aviso que manda el Coordinador (POST /api/trabajador/aviso): solo "limite" o "necesita"; otro tipo, o sin
 * tipo, se descarta sin error. Respeta interruptor, silencio y el "uno por problema cada 3 horas".
 */
export async function registrarAvisoDelCoordinador(
  workspaceId: string,
  tipo: unknown,
  texto: string,
  ahora: Date = new Date(),
): Promise<{ descartado?: true; apagado?: true; silenciado?: true; repetido?: true; salio?: boolean; motivo?: string | null; linea?: string; numero?: string }> {
  if (typeof tipo !== "string" || !(TIPOS_DEL_COORDINADOR as readonly string[]).includes(tipo)) return { descartado: true };
  if (!(await avisosPrendidos(workspaceId))) return { apagado: true };
  if (enSilencioDeAvisos(ahora)) return { silenciado: true };
  const estado = await leerEstadoDeAvisos(workspaceId);
  const clave = `coord:${tipo}:${texto}`;
  if (yaSeAvisoDe(estado, clave, ahora)) return { repetido: true };
  const envio = await enviarAlDueno(workspaceId, texto);
  if (envio.salio) estado.avisados[clave] = ahora.toISOString();
  anotarEnHistorial(estado, { cuando: ahora.toISOString(), tipo, texto, salio: envio.salio, motivo: envio.salio ? null : `no salió: ${envio.motivo}` });
  await guardarEstadoDeAvisos(workspaceId, estado);
  return envio;
}

/** El botón "Mandar prueba": sale aunque el interruptor esté apagado o sea de noche (es a pedido del dueño). */
export async function mandarPruebaAlDueno(workspaceId: string, ahora: Date = new Date()): Promise<ResultadoDelEnvio> {
  const texto = `✅ Prueba de avisos de Sistemas: si lo lee, los avisos llegan bien.\nVer: ${linkDelCoordinador()}`;
  const envio = await enviarAlDueno(workspaceId, texto);
  const estado = await leerEstadoDeAvisos(workspaceId);
  anotarEnHistorial(estado, { cuando: ahora.toISOString(), tipo: "prueba", texto, salio: envio.salio, motivo: envio.salio ? null : `no salió: ${envio.motivo}` });
  await guardarEstadoDeAvisos(workspaceId, estado);
  return envio;
}

/** Lo que muestra la caja de Mi empresa → Claude (solo la ven el dueño o un administrador). */
export async function avisosParaLaPantalla(workspaceId: string) {
  const [activo, telefono, estado] = await Promise.all([avisosPrendidos(workspaceId), telefonoGuardado(workspaceId), leerEstadoDeAvisos(workspaceId)]);
  return { activo, telefono, ultimos: estado.historial };
}
