/**
 * COACH DE VENTAS: las reglas que se calculan SIN IA.
 *
 * Quien escribio cada mensaje, cuanto espero el cliente en horario laboral, si quedo sin respuesta,
 * el puntaje de la rubrica, el enmascarado de telefonos y el armado del prompt. Todo puro: no toca
 * la base ni la red, para poder probarlo con `npm run test:coach` sin nada corriendo.
 *
 * Lo medible se mide aca y la IA solo lee el texto: la Fase A mostro que pedirle a la IA que
 * deduzca demoras de un texto sin reloj sale mal, y que las demoras son un dato, no una opinion.
 */

import { POLITICA_COACH, type EjeDeRubrica, type HorarioLaboral, type PoliticaCoach } from "./politica";

/* ------------------------------------------------------------------------------------------------
   Mensajes: quien dijo que
------------------------------------------------------------------------------------------------ */

export type Autor = "cliente" | "asesora" | "bot" | "sistema";

/** Lo minimo que se lee de un mensaje de la base (Message o OfficialApiMessage). */
export type MensajeCrudo = {
  id: string;
  direction: string;
  type: string;
  content: string | null;
  transcripcion?: string | null;
  rawPayload: unknown;
  createdAt: Date;
  isStatusBroadcast?: boolean | null;
  deletedAt?: Date | null;
};

export type NotaDeActividad = {
  kind: string;
  actorUserId: string | null;
  assigneeUserId: string | null;
};

export type MensajeCoach = {
  id: string;
  en: Date;
  autor: Autor;
  /** Quien lo mando, si se sabe (solo lo escrito desde el CRM desde el 28-sep). */
  userId: string | null;
  /** Escrito desde el celular de la linea: es una persona, pero no se sabe cual. */
  desdeCelular: boolean;
  tipo: string;
  texto: string;
  nota: NotaDeActividad | null;
};

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

function cadena(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/** Mismo criterio que `quienDijo` del MCP (src/lib/mcp/herramientas.ts). */
export function autorDelMensaje(mensaje: Pick<MensajeCrudo, "direction" | "type" | "rawPayload">): {
  autor: Autor;
  userId: string | null;
  desdeCelular: boolean;
} {
  const payload = objeto(mensaje.rawPayload);
  if (mensaje.type === "SYSTEM") {
    return { autor: "sistema", userId: cadena(payload.actorUserId), desdeCelular: false };
  }
  if (mensaje.direction === "INBOUND") {
    return { autor: "cliente", userId: null, desdeCelular: false };
  }
  const origen = payload.source;
  if (origen === "activity" || origen === "llamada") {
    return { autor: "sistema", userId: cadena(payload.actorUserId), desdeCelular: false };
  }
  if (origen === "manual") {
    return { autor: "asesora", userId: cadena(payload.enviadoPorUserId), desdeCelular: false };
  }
  if (origen === "instance") {
    return { autor: "asesora", userId: null, desdeCelular: true };
  }
  return { autor: "bot", userId: null, desdeCelular: false };
}

/** Las notas que SI le sirven al coach: quien tenia el chat y los cambios de etapa. */
const NOTAS_QUE_SE_QUEDAN = new Set(["assigned", "unassigned", "stage_changed"]);

/**
 * ¿Se saca esta nota antes de mandar el chat a la IA?
 *
 * Las notas SYSTEM del Agente V3 ("Agente V3: Ganó ... porque el cliente dijo ...") eran cerca del
 * 40 % del texto en la Fase A y no dicen nada de la venta. Se van todas las notas del sistema salvo
 * asignaciones y cambios de etapa, que si explican quien tenia el chat y cuando se descarto.
 */
export function esNotaQueSeFiltra(mensaje: Pick<MensajeCrudo, "type" | "content" | "rawPayload">): boolean {
  if (mensaje.type !== "SYSTEM") {
    const origen = objeto(mensaje.rawPayload).source;
    return origen === "activity" || origen === "llamada";
  }
  const texto = (mensaje.content ?? "").trimStart();
  if (texto.startsWith("Agente V3:")) {
    return true;
  }
  const kind = objeto(mensaje.rawPayload).kind;
  return !(typeof kind === "string" && NOTAS_QUE_SE_QUEDAN.has(kind));
}

/** El texto de un mensaje para leerlo: audios por su transcripcion, fotos y documentos marcados. */
export function textoDelMensaje(mensaje: Pick<MensajeCrudo, "type" | "content" | "transcripcion">): string {
  const contenido = (mensaje.content ?? "").replace(/\s+/g, " ").trim();
  switch (mensaje.type) {
    case "AUDIO": {
      const dicho = (mensaje.transcripcion ?? "").replace(/\s+/g, " ").trim();
      return dicho ? `[audio] ${dicho}` : "[audio sin transcribir]";
    }
    case "IMAGE":
      return contenido ? `[foto] ${contenido}` : "[foto]";
    case "VIDEO":
      return contenido ? `[video] ${contenido}` : "[video]";
    case "DOCUMENT":
      return contenido ? `[documento] ${contenido}` : "[documento]";
    case "STICKER":
      return "[sticker]";
    case "LOCATION":
      return "[ubicación]";
    case "CONTACTS":
      return "[tarjeta de contacto]";
    default:
      return contenido;
  }
}

/**
 * De los mensajes crudos de un chat a la lista que usa el coach, en orden y sin ruido: sin
 * estados de WhatsApp, sin borrados, sin las notas internas del bot.
 */
export function normalizarMensajes(crudos: MensajeCrudo[]): MensajeCoach[] {
  return [...crudos]
    .filter((mensaje) => !mensaje.isStatusBroadcast && !mensaje.deletedAt)
    .filter((mensaje) => !esNotaQueSeFiltra(mensaje))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((mensaje) => {
      const { autor, userId, desdeCelular } = autorDelMensaje(mensaje);
      const payload = objeto(mensaje.rawPayload);
      const nota =
        mensaje.type === "SYSTEM"
          ? {
              kind: cadena(payload.kind) ?? "note",
              actorUserId: cadena(payload.actorUserId),
              assigneeUserId: cadena(payload.assigneeUserId),
            }
          : null;
      return {
        id: mensaje.id,
        en: mensaje.createdAt,
        autor,
        userId,
        desdeCelular,
        tipo: mensaje.type,
        texto: textoDelMensaje(mensaje),
        nota,
      };
    })
    .filter((mensaje) => mensaje.autor === "sistema" || mensaje.texto.length > 0);
}

/* ------------------------------------------------------------------------------------------------
   Datos personales
------------------------------------------------------------------------------------------------ */

/** "…1234": lo unico del telefono que sale del CRM. */
export function ultimos4(telefono: string | null | undefined): string {
  const digitos = (telefono ?? "").replace(/\D/g, "");
  return digitos.length >= 4 ? `…${digitos.slice(-4)}` : "…";
}

/**
 * Saca del texto lo que no tiene por que ir a la IA ni al informe: telefonos, cedulas, cuentas
 * (toda corrida de 7 o mas digitos, con espacios o guiones, queda como "[número …1234]") y correos.
 *
 * Los precios se respetan: "$1.129.000" y "989.000" tienen puntos de miles y no se tocan; una cifra
 * pegada a "$" tampoco.
 */
export function limpiarDatosPersonales(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[correo]")
    .replace(/(\$\s?)?\+?\d[\d \-]{5,}\d/g, (coincidencia, pesos: string | undefined) => {
      if (pesos) return coincidencia;
      const digitos = coincidencia.replace(/\D/g, "");
      if (digitos.length < 7) return coincidencia;
      return `[número …${digitos.slice(-4)}]`;
    });
}

/** Del nombre del contacto, lo que NO es el primer nombre (apellidos): se tapa si aparece en el chat. */
export function apellidosDe(nombre: string | null | undefined): string[] {
  const partes = (nombre ?? "").replace(/[^\p{L}\s'-]/gu, " ").trim().split(/\s+/).slice(1);
  return partes.filter((parte) => parte.length >= 3);
}

function escaparRegex(texto: string) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Tapa palabras puntuales (apellidos del cliente) en un texto, sin importar mayusculas. */
export function ocultarPalabras(texto: string, palabras: string[]): string {
  let salida = texto;
  for (const palabra of palabras) {
    salida = salida.replace(new RegExp(`(?<![\\p{L}])${escaparRegex(palabra)}(?![\\p{L}])`, "giu"), "[…]");
  }
  return salida;
}

/** Solo el primer nombre, y nada si el "nombre" es un numero. */
export function primerNombre(nombre: string | null | undefined): string {
  const limpio = (nombre ?? "").replace(/[^\p{L}\s'-]/gu, " ").trim();
  const primero = limpio.split(/\s+/)[0] ?? "";
  if (primero.length < 2) return "";
  return primero.charAt(0).toUpperCase() + primero.slice(1).toLowerCase();
}

/* ------------------------------------------------------------------------------------------------
   Dias y horario laboral (hora de Bogota)
------------------------------------------------------------------------------------------------ */

const MS_MIN = 60_000;
const MS_DIA = 24 * 60 * MS_MIN;

/** "2026-10-08" -> rango [desde, hasta) del dia en Bogota, y la fecha clave (medianoche UTC). */
export function rangoDelDia(dia: string, desfaseMin: number = POLITICA_COACH.desfaseBogotaMin) {
  const clave = new Date(`${dia}T00:00:00.000Z`);
  const desde = new Date(clave.getTime() - desfaseMin * MS_MIN);
  return { clave, desde, hasta: new Date(desde.getTime() + MS_DIA) };
}

/** El dia (YYYY-MM-DD) de un instante, en Bogota. */
export function diaEnBogota(fecha: Date, desfaseMin: number = POLITICA_COACH.desfaseBogotaMin): string {
  return new Date(fecha.getTime() + desfaseMin * MS_MIN).toISOString().slice(0, 10);
}

export function esDiaValido(valor: unknown): valor is string {
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(`${valor}T00:00:00Z`));
}

function aMinutos(hora: string) {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Minutos LABORALES entre dos instantes: solo cuenta lo que cae dentro del horario de cada dia.
 * Un cliente que escribe el viernes a las 17:50 y recibe respuesta el lunes a las 8:05 espero 15
 * minutos laborales, no 62 horas.
 */
export function minutosLaborales(
  desde: Date,
  hasta: Date,
  horario: HorarioLaboral = POLITICA_COACH.horario,
  desfaseMin: number = POLITICA_COACH.desfaseBogotaMin,
): number {
  if (hasta.getTime() <= desde.getTime()) return 0;
  let total = 0;
  // Medianoche local del dia de `desde`, como instante UTC.
  const inicioLocal = new Date(desde.getTime() + desfaseMin * MS_MIN);
  let medianoche = Date.UTC(inicioLocal.getUTCFullYear(), inicioLocal.getUTCMonth(), inicioLocal.getUTCDate()) - desfaseMin * MS_MIN;
  // Tope de seguridad: 60 dias.
  for (let vuelta = 0; vuelta < 60 && medianoche < hasta.getTime(); vuelta += 1) {
    const diaSemana = new Date(medianoche + desfaseMin * MS_MIN + 12 * 60 * MS_MIN).getUTCDay() as keyof HorarioLaboral;
    const tramo = horario[diaSemana];
    if (tramo) {
      const abre = medianoche + aMinutos(tramo.desde) * MS_MIN;
      const cierra = medianoche + aMinutos(tramo.hasta) * MS_MIN;
      const a = Math.max(abre, desde.getTime());
      const b = Math.min(cierra, hasta.getTime());
      if (b > a) total += (b - a) / MS_MIN;
    }
    medianoche += MS_DIA;
  }
  return Math.round(total);
}

export function estaEnHorario(
  fecha: Date,
  horario: HorarioLaboral = POLITICA_COACH.horario,
  desfaseMin: number = POLITICA_COACH.desfaseBogotaMin,
): boolean {
  const local = new Date(fecha.getTime() + desfaseMin * MS_MIN);
  const tramo = horario[local.getUTCDay() as keyof HorarioLaboral];
  if (!tramo) return false;
  const minutos = local.getUTCHours() * 60 + local.getUTCMinutes();
  return minutos >= aMinutos(tramo.desde) && minutos < aMinutos(tramo.hasta);
}

/* ------------------------------------------------------------------------------------------------
   Esperas: el cliente escribio y una PERSONA no respondio
------------------------------------------------------------------------------------------------ */

const CIERRES = new Set([
  "ok",
  "okey",
  "okay",
  "oki",
  "vale",
  "listo",
  "dale",
  "bueno",
  "perfecto",
  "gracias",
  "muchas gracias",
  "mil gracias",
  "bendiciones",
  "igualmente",
  "si",
  "sí",
  "entiendo",
  "entiendo gracias",
  "ok gracias",
  "listo gracias",
]);

/** "Gracias", "ok", un sticker: no es una pregunta que espere respuesta. */
export function esCierreTrivial(mensaje: Pick<MensajeCoach, "tipo" | "texto">): boolean {
  if (mensaje.tipo === "STICKER") return true;
  const limpio = mensaje.texto
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limpio) return true;
  return CIERRES.has(limpio);
}

export type EventoDeEspera = {
  tipo: "demora" | "sin_respuesta";
  /** Cuando empezo a esperar (dentro de la ventana que se juzga). */
  desde: Date;
  /** Cuando le respondio una persona; null si nunca. */
  hasta: Date | null;
  minutos: number;
};

/**
 * Recorre el chat y devuelve las esperas del cliente que pasaron el umbral EN HORARIO LABORAL.
 *
 * - Una espera empieza con el primer mensaje del cliente (que no sea un "gracias") despues de la
 *   ultima respuesta de una persona, y termina cuando una PERSONA escribe. Lo que contesta el bot
 *   no la termina: el bot no cierra ventas.
 * - Solo se juzga desde `desde` (inicio del dia, o desde que el chat le cayo a la asesora).
 * - Si a la hora de `corte` sigue esperando y ya paso el umbral laboral: "sin_respuesta".
 */
export function detectarEsperas(input: {
  mensajes: MensajeCoach[];
  desde: Date;
  corte: Date;
  horario?: HorarioLaboral;
  umbralMin?: number;
  desfaseMin?: number;
}): { eventos: EventoDeEspera[]; primeraRespuestaMin: number | null; huboEspera: boolean } {
  const horario = input.horario ?? POLITICA_COACH.horario;
  const umbral = input.umbralMin ?? POLITICA_COACH.demoraMaximaMin;
  const desfase = input.desfaseMin ?? POLITICA_COACH.desfaseBogotaMin;
  const eventos: EventoDeEspera[] = [];
  let esperandoDesde: Date | null = null;
  let primeraRespuestaMin: number | null = null;
  let huboEspera = false;

  for (const mensaje of input.mensajes) {
    if (mensaje.en.getTime() >= input.corte.getTime()) break;
    if (mensaje.autor === "cliente") {
      if (!esperandoDesde && !esCierreTrivial(mensaje)) esperandoDesde = mensaje.en;
      continue;
    }
    if (mensaje.autor !== "asesora" || !esperandoDesde) continue;
    if (mensaje.en.getTime() > input.desde.getTime()) {
      const inicio = new Date(Math.max(esperandoDesde.getTime(), input.desde.getTime()));
      const minutos = minutosLaborales(inicio, mensaje.en, horario, desfase);
      huboEspera = true;
      if (primeraRespuestaMin === null) primeraRespuestaMin = minutos;
      if (minutos > umbral) eventos.push({ tipo: "demora", desde: inicio, hasta: mensaje.en, minutos });
    }
    esperandoDesde = null;
  }

  if (esperandoDesde) {
    const inicio = new Date(Math.max(esperandoDesde.getTime(), input.desde.getTime()));
    const minutos = minutosLaborales(inicio, input.corte, horario, desfase);
    if (minutos > 0) huboEspera = true;
    if (minutos >= umbral) eventos.push({ tipo: "sin_respuesta", desde: inicio, hasta: null, minutos });
  }

  return { eventos, primeraRespuestaMin, huboEspera };
}

/* ------------------------------------------------------------------------------------------------
   Otras senales duras
------------------------------------------------------------------------------------------------ */

const RE_COTIZACION = /\bCOT[-\s]?\d{3,}\b/i;

/** ¿Le llego una cotizacion? Un COT-00123 escrito o un documento que se llama "cotizacion". */
export function huboCotizacion(mensajes: MensajeCoach[], desde?: Date): boolean {
  return mensajes.some(
    (mensaje) =>
      mensaje.autor !== "cliente" &&
      mensaje.autor !== "sistema" &&
      (!desde || mensaje.en.getTime() >= desde.getTime()) &&
      (RE_COTIZACION.test(mensaje.texto) || (mensaje.tipo === "DOCUMENT" && /cotiz/i.test(mensaje.texto))),
  );
}

export function mencionaContraentrega(texto: string): boolean {
  return /contra\s*-?\s*entrega/i.test(texto);
}

/**
 * Descartar (pasar a Perdido) a un cliente que escribio hace menos de 72 h es prematuro: en la
 * Fase A, 4 de 10 perdidas eran descartes de minutos u horas (Mocoa, Cali con visita agendada).
 */
export function esDescartePrematuro(input: {
  descartadoEn: Date;
  ultimoMensajeDelClienteEn: Date | null;
  horasMinimas?: number;
}): boolean {
  if (!input.ultimoMensajeDelClienteEn) return false;
  const horas = (input.descartadoEn.getTime() - input.ultimoMensajeDelClienteEn.getTime()) / 3_600_000;
  return horas >= 0 && horas < (input.horasMinimas ?? POLITICA_COACH.horasMinimasParaDescartar);
}

export function esNotaDeDescarte(mensaje: MensajeCoach): boolean {
  return mensaje.nota?.kind === "stage_changed" && /perdid|descartad/i.test(mensaje.texto);
}

/* ------------------------------------------------------------------------------------------------
   Puntaje
------------------------------------------------------------------------------------------------ */

export type Ejes = Partial<Record<EjeDeRubrica, number | null>>;

/** Velocidad desde las esperas medidas. null = no hubo nada que responder en horario. */
export function ejeVelocidad(esperas: { eventos: EventoDeEspera[]; huboEspera: boolean }): number | null {
  if (!esperas.huboEspera && esperas.eventos.length === 0) return null;
  let nota = 10;
  for (const evento of esperas.eventos) {
    if (evento.tipo === "sin_respuesta") nota -= 4;
    else nota -= evento.minutos > 60 ? 3 : 2;
  }
  return Math.max(0, nota);
}

/**
 * Promedio ponderado de los ejes que aplican. Los ejes en null ("no aplica": seguimiento de una
 * venta que cerro el mismo dia) no cuentan y su peso se reparte. Resultado no esta en los pesos.
 */
export function puntajePonderado(ejes: Ejes, pesos: Record<EjeDeRubrica, number> = POLITICA_COACH.pesos): number | null {
  let suma = 0;
  let pesoTotal = 0;
  for (const eje of Object.keys(pesos) as EjeDeRubrica[]) {
    const valor = ejes[eje];
    if (typeof valor !== "number" || !Number.isFinite(valor)) continue;
    const acotado = Math.min(10, Math.max(0, valor));
    suma += acotado * pesos[eje];
    pesoTotal += pesos[eje];
  }
  return pesoTotal > 0 ? Math.round((suma / pesoTotal) * 10) / 10 : null;
}

/** Promedio de los ejes de varios chats, eje por eje (sin contar los null). */
export function promedioDeEjes(lista: Ejes[]): Ejes {
  const salida: Ejes = {};
  for (const eje of Object.keys(POLITICA_COACH.pesos) as EjeDeRubrica[]) {
    const valores = lista.map((ejes) => ejes[eje]).filter((v): v is number => typeof v === "number");
    salida[eje] = valores.length ? Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 10) / 10 : null;
  }
  return salida;
}

/* ------------------------------------------------------------------------------------------------
   Costo e idempotencia
------------------------------------------------------------------------------------------------ */

export function costoUsd(
  modelo: string,
  tokensEntrada: number,
  tokensSalida: number,
  precios: Record<string, { entrada: number; salida: number }> = POLITICA_COACH.ia.precios,
): number {
  const precio = precios[modelo] ?? precios[POLITICA_COACH.ia.modelo];
  if (!precio) return 0;
  return Math.round(((tokensEntrada * precio.entrada + tokensSalida * precio.salida) / 1_000_000) * 10_000) / 10_000;
}

export type DecisionDeCorrida = "generar" | "omitir_listo" | "omitir_en_curso";

/**
 * Un informe por negocio y dia. El reloj pasa cada minuto entre 23:30 y 23:58: solo la primera
 * pasada genera; las demas ven el informe y no hacen nada. Un informe EN_CURSO de hace mas de
 * `minutosDeBloqueo` se da por caido (el servidor se reinicio) y se vuelve a generar.
 * "Generar ahora" (force) rehace un informe LISTO o con ERROR, pero nunca pisa uno que esta corriendo.
 */
export function decidirCorrida(
  existente: { estado: string; iniciadoEn: Date } | null,
  opciones: { force?: boolean; ahora?: Date; minutosDeBloqueo?: number } = {},
): DecisionDeCorrida {
  if (!existente) return "generar";
  const ahora = opciones.ahora ?? new Date();
  const bloqueo = (opciones.minutosDeBloqueo ?? 30) * MS_MIN;
  if (existente.estado === "EN_CURSO" && ahora.getTime() - existente.iniciadoEn.getTime() < bloqueo) {
    return "omitir_en_curso";
  }
  if (opciones.force) return "generar";
  if (existente.estado === "LISTO") return "omitir_listo";
  // ERROR o EN_CURSO viejo: el reloj lo reintenta.
  return "generar";
}

/** ¿Esta el reloj en la ventana del coach? (23:30 a 23:58, hora de Bogota). */
export function enVentanaDelReloj(ahora: Date, politica: PoliticaCoach = POLITICA_COACH): boolean {
  const local = new Date(ahora.getTime() + politica.desfaseBogotaMin * MS_MIN);
  const minutos = local.getUTCHours() * 60 + local.getUTCMinutes();
  const desde = politica.reloj.hora * 60 + politica.reloj.minuto;
  return minutos >= desde && minutos < 23 * 60 + 59;
}

/* ------------------------------------------------------------------------------------------------
   Prompt
------------------------------------------------------------------------------------------------ */

const HORA = (fecha: Date, desfaseMin: number) => new Date(fecha.getTime() + desfaseMin * MS_MIN).toISOString().slice(11, 16);
const DIA_CORTO = (fecha: Date, desfaseMin: number) => new Date(fecha.getTime() + desfaseMin * MS_MIN).toISOString().slice(5, 10);

const ETIQUETA_DEL_AUTOR: Record<Autor, string> = {
  cliente: "CLIENTE",
  asesora: "ASESORA",
  bot: "BOT",
  sistema: "NOTA",
};

/**
 * El chat como texto para la IA: hora, quien y que, con los datos personales limpios y cada turno
 * recortado. Los turnos de antes del dia van primero, como contexto, y no se juzgan.
 */
export function transcripcionParaIA(
  mensajes: MensajeCoach[],
  opciones: {
    inicioDelDia: Date;
    maxCaracteres?: number;
    turnosDeContexto?: number;
    maxTurnosDelDia?: number;
    desfaseMin?: number;
    nombres?: Record<string, string>;
    /** Apellidos del cliente: se tapan si aparecen en el texto. */
    ocultar?: string[];
  },
): string {
  const max = opciones.maxCaracteres ?? POLITICA_COACH.ia.maxCaracteresPorTurno;
  const desfase = opciones.desfaseMin ?? POLITICA_COACH.desfaseBogotaMin;
  const antes = mensajes.filter((m) => m.en.getTime() < opciones.inicioDelDia.getTime());
  const hoy = mensajes.filter((m) => m.en.getTime() >= opciones.inicioDelDia.getTime());
  const contexto = antes.slice(-(opciones.turnosDeContexto ?? POLITICA_COACH.ia.turnosDeContexto));
  const delDia = hoy.slice(-(opciones.maxTurnosDelDia ?? POLITICA_COACH.ia.maxTurnosDelDia));

  const linea = (mensaje: MensajeCoach, conDia: boolean) => {
    let quien = ETIQUETA_DEL_AUTOR[mensaje.autor];
    if (mensaje.autor === "asesora") {
      const nombre = mensaje.userId ? opciones.nombres?.[mensaje.userId] : null;
      quien = nombre ? `ASESORA ${nombre}` : mensaje.desdeCelular ? "ASESORA (celular)" : "ASESORA";
    }
    const texto = ocultarPalabras(limpiarDatosPersonales(mensaje.texto), opciones.ocultar ?? []).slice(0, max);
    const cuando = conDia ? `${DIA_CORTO(mensaje.en, desfase)} ${HORA(mensaje.en, desfase)}` : HORA(mensaje.en, desfase);
    return `[${cuando}] ${quien}: ${texto}`;
  };

  const partes: string[] = [];
  if (contexto.length) {
    partes.push("-- antes de hoy (contexto, no se juzga) --", ...contexto.map((m) => linea(m, true)));
  }
  partes.push("-- hoy --", ...(delDia.length ? delDia.map((m) => linea(m, false)) : ["(sin mensajes hoy)"]));
  return partes.join("\n");
}

/** Las reglas del negocio para el prompt, armadas desde la politica (sin repetir listas). */
export function reglasParaElPrompt(politica: PoliticaCoach = POLITICA_COACH): string[] {
  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const horario = (Object.keys(politica.horario) as unknown as Array<keyof HorarioLaboral>)
    .map((dia) => {
      const tramo = politica.horario[dia];
      return `${dias[Number(dia)]} ${tramo ? `${tramo.desde}-${tramo.hasta}` : "no se trabaja"}`;
    })
    .join(", ");
  return [
    ...politica.reglasDelNegocio,
    `Forma de pago: ${politica.pago.unicaForma}.`,
    politica.pago.contraentregaPermitida
      ? "La contraentrega está permitida."
      : `La contraentrega está SUSPENDIDA: ofrecerla es error de la asesora, salvo en los chats que terminan en ${politica.pago.contraentregasRespetadas.join(", ")} (ya se había ofrecido y se respeta). Nunca la sugieras en el siguiente mensaje.`,
    `Envío GRATIS con pago 50/50 en: ${politica.envio.gratis.join(", ")}. Cobrar envío ahí es error de la asesora.`,
    `Adicional fijo de $${politica.envio.adicional.valor.toLocaleString("es-CO")} en: ${politica.envio.adicional.ciudades.join(", ")}.`,
    `Se cotiza el envío antes de cerrar: ${politica.envio.seCotiza.join(", ")}. Prometer cotizar y no volver con la cifra es error.`,
    `No llegamos (solo avión): ${politica.envio.noLlegamos.join(", ")}. Esos clientes son "no_perseguir" y no es error de la asesora.`,
    `Horario laboral (hora de Bogotá): ${horario}. Fuera de ese horario no se castiga la velocidad.`,
  ];
}

export const TIPOS_DE_ERROR = [
  "promesa_sin_cumplir",
  "cobro_envio_gratis",
  "contraentrega",
  "sin_cotizacion",
  "descarte_prematuro",
  "sin_total_claro",
  "dato_errado",
  "otro",
] as const;
export type TipoDeError = (typeof TIPOS_DE_ERROR)[number] | "sin_respuesta" | "demora";

export const TEMPERATURAS = ["caliente", "tibio", "frio", "cerrado", "no_perseguir"] as const;
export type Temperatura = (typeof TEMPERATURAS)[number];

export const MOTIVOS_DE_NO_CIERRE = [
  "mala_ejecucion",
  "sin_intencion",
  "sin_dinero",
  "precio",
  "envio",
  "producto",
  "sistema",
  "bien_trabajada_no_cerro",
  "en_curso",
  "vendida",
] as const;
export type MotivoDeNoCierre = (typeof MOTIVOS_DE_NO_CIERRE)[number];

/** Lo que el coach sabe de un chat antes de mandarlo a la IA. Sin telefonos: solo …1234. */
export type FichaParaIA = {
  ref: string;
  ultimos4: string;
  nombre: string;
  etapa: string;
  /** Chat quieto (sin mensajes hoy): solo se pide temperatura y siguiente mensaje. */
  soloPendiente: boolean;
  hechos: string[];
  transcripcion: string;
};

export function armarPromptDelLote(input: {
  asesora: string;
  dia: string;
  fichas: FichaParaIA[];
  politica?: PoliticaCoach;
}): { sistema: string; usuario: string } {
  const politica = input.politica ?? POLITICA_COACH;
  const sistema = [
    "Eres el coach de ventas de Magilus. Lees los chats de WhatsApp de UNA asesora en un día y devuelves SOLO un JSON.",
    "Reglas del negocio (vigentes, no las discutas):",
    ...reglasParaElPrompt(politica).map((regla) => `- ${regla}`),
    "",
    "Cómo juzgar:",
    "- Juzga SOLO lo que hizo la ASESORA en la sección '-- hoy --'. Lo que dijo el BOT, una plantilla o una regla que falta va en fallasDelSistema, nunca en errores.",
    "- Los 'Hechos medidos' (demoras, sin respuesta, cotización) ya están calculados con reloj: no los recalcules ni los repitas como errores; úsalos para entender.",
    "- Ejes de 0 a 10: N = entendió la necesidad y manejó objeciones; A = avanzó al cierre (total claro, pidió datos, cotización); S = seguimiento (null si cerró la venta hoy mismo o si no había nada que seguir); C = comunicación (claro, corto, un solo total, tono de la marca).",
    `- errores: lista de {"tipo","detalle"}; tipo uno de ${TIPOS_DE_ERROR.map((t) => `"${t}"`).join(", ")}. detalle: 1 frase concreta con lo que pasó. Solo errores reales de la asesora.`,
    "- aciertos: hasta 2 frases cortas con lo que hizo bien (concreto).",
    `- temperatura: ${TEMPERATURAS.map((t) => `"${t}"`).join(", ")}. caliente = eligió producto/color o pidió cómo pagar; tibio = pregunta precio/envío con interés; cerrado = ya compró; no_perseguir = no llegamos o dijo que no.`,
    `- motivoNoCierre: uno de ${MOTIVOS_DE_NO_CIERRE.map((m) => `"${m}"`).join(", ")}.`,
    "- porque: 1 frase con lo que falta para cerrar.",
    "- siguienteMensaje: si es caliente o tibio, el mensaje que la asesora debería mandar mañana (1 o 2 líneas, de tú, tono de la marca, con un solo total si aplica, sin contraentrega, envío gratis solo según la lista). Si no, \"\". No uses el nombre completo ni datos del cliente: a lo sumo su primer nombre.",
    "- fallasDelSistema: frases cortas de errores del bot, plantillas o reglas que faltan (lista vacía si no hay).",
    "- En los chats marcados SOLO_PENDIENTE no hay mensajes de hoy: devuelve ejes en null, errores y aciertos vacíos, y llena temperatura, porque y siguienteMensaje.",
    "",
    'Forma exacta: {"chats":[{"ref":"#123","ejes":{"N":7,"A":5,"S":null,"C":6},"aciertos":["..."],"errores":[{"tipo":"...","detalle":"..."}],"fallasDelSistema":["..."],"temperatura":"tibio","motivoNoCierre":"envio","porque":"...","siguienteMensaje":"..."}],"resumen":{"loQueHizoBien":"...","unaCosaAMejorar":"...","ejemplo":"chat #123: qué pasó y qué habría sido mejor"}}',
    "Un objeto por cada chat recibido, con su mismo ref. Español, frases cortas.",
  ].join("\n");

  const usuario = [
    `Asesora: ${input.asesora}. Día: ${input.dia}.`,
    "",
    ...input.fichas.map((ficha) =>
      [
        `### Chat ${ficha.ref} · ${ficha.ultimos4}${ficha.nombre ? ` · ${ficha.nombre}` : ""} · etapa CRM: ${ficha.etapa}${ficha.soloPendiente ? " · SOLO_PENDIENTE" : ""}`,
        ficha.hechos.length ? `Hechos medidos: ${ficha.hechos.join("; ")}` : "Hechos medidos: ninguno",
        ficha.transcripcion,
        "",
      ].join("\n"),
    ),
  ].join("\n");

  return { sistema, usuario };
}

/* ------------------------------------------------------------------------------------------------
   Lo que devuelve la IA
------------------------------------------------------------------------------------------------ */

export type AnalisisDeChat = {
  ref: string;
  ejes: { N: number | null; A: number | null; S: number | null; C: number | null };
  aciertos: string[];
  errores: Array<{ tipo: TipoDeError; detalle: string }>;
  fallasDelSistema: string[];
  temperatura: Temperatura;
  motivoNoCierre: MotivoDeNoCierre;
  porque: string;
  siguienteMensaje: string;
};

export type ResumenDeAsesora = { loQueHizoBien: string; unaCosaAMejorar: string; ejemplo: string };

function nota(valor: unknown): number | null {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor) : NaN;
  return Number.isFinite(numero) ? Math.min(10, Math.max(0, Math.round(numero * 10) / 10)) : null;
}

function texto(valor: unknown, max: number): string {
  return typeof valor === "string" ? limpiarDatosPersonales(valor.replace(/\s+/g, " ").trim()).slice(0, max) : "";
}

function lista(valor: unknown, max: number, largo: number): string[] {
  return Array.isArray(valor) ? valor.map((v) => texto(v, largo)).filter(Boolean).slice(0, max) : [];
}

/** Valida el JSON de la IA. Lo que no se entienda se descarta; un ref que no se pidio, tambien. */
export function parsearRespuestaDelLote(
  crudo: string | null | undefined,
  refs: string[],
): { chats: Map<string, AnalisisDeChat>; resumen: ResumenDeAsesora | null } {
  const chats = new Map<string, AnalisisDeChat>();
  if (!crudo) return { chats, resumen: null };
  let datos: Record<string, unknown>;
  try {
    datos = objeto(JSON.parse(crudo.replace(/```json/gi, "").replace(/```/g, "").trim()));
  } catch {
    return { chats, resumen: null };
  }
  const pedidos = new Set(refs);
  for (const item of Array.isArray(datos.chats) ? datos.chats : []) {
    const fila = objeto(item);
    const ref = typeof fila.ref === "string" ? fila.ref.trim() : "";
    if (!pedidos.has(ref) || chats.has(ref)) continue;
    const ejes = objeto(fila.ejes);
    const temperatura = String(fila.temperatura ?? "").toLowerCase() as Temperatura;
    const motivo = String(fila.motivoNoCierre ?? "").toLowerCase() as MotivoDeNoCierre;
    chats.set(ref, {
      ref,
      ejes: { N: nota(ejes.N), A: nota(ejes.A), S: nota(ejes.S), C: nota(ejes.C) },
      aciertos: lista(fila.aciertos, 2, 200),
      errores: (Array.isArray(fila.errores) ? fila.errores : [])
        .map((e) => {
          const error = objeto(e);
          const tipo = String(error.tipo ?? "").toLowerCase();
          return {
            tipo: ((TIPOS_DE_ERROR as readonly string[]).includes(tipo) ? tipo : "otro") as TipoDeError,
            detalle: texto(error.detalle, 240),
          };
        })
        .filter((error) => error.detalle)
        .slice(0, 4),
      fallasDelSistema: lista(fila.fallasDelSistema, 3, 200),
      temperatura: (TEMPERATURAS as readonly string[]).includes(temperatura) ? temperatura : "frio",
      motivoNoCierre: (MOTIVOS_DE_NO_CIERRE as readonly string[]).includes(motivo) ? motivo : "en_curso",
      porque: texto(fila.porque, 200),
      siguienteMensaje: texto(fila.siguienteMensaje, 300),
    });
  }
  const r = objeto(datos.resumen);
  const resumen =
    r.loQueHizoBien || r.unaCosaAMejorar
      ? { loQueHizoBien: texto(r.loQueHizoBien, 300), unaCosaAMejorar: texto(r.unaCosaAMejorar, 300), ejemplo: texto(r.ejemplo, 400) }
      : null;
  return { chats, resumen };
}

/** Ningun "siguiente mensaje" puede ofrecer contraentrega mientras este suspendida. */
export function mensajeSugeridoValido(mensaje: string, politica: PoliticaCoach = POLITICA_COACH): string {
  if (!mensaje) return "";
  if (!politica.pago.contraentregaPermitida && mencionaContraentrega(mensaje)) return "";
  return mensaje;
}
