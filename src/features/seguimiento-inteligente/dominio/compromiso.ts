/**
 * COMPROMISO DEL CLIENTE CON MOMENTO (código puro). Alexander, 13-10-2026: "No enviar + tarea a la
 * hora".
 *
 * Falla real (13-oct, chat •••• 6626, Ventas 1): la clienta escribió 11:46 «En la tarde / ella se
 * llama Danna / apenas ella esta alla / te enviaria la transferencia / es el 50% / cierto»; la
 * asesora mandó un audio, la clienta «Mil gracias», la asesora «Gracias a ti». A las 12:57 salió el
 * automático "¿Pudiste ver lo que te envié?". No aplicaba: la clienta había dicho CUÁNDO iba a
 * pagar. Lo que sirve es que la asesora le escriba EN LA TARDE por lo que quedó.
 *
 * Es compromiso (por palabras, sin IA) una tanda del cliente que trae:
 *  - una ACCIÓN suya a futuro ("te envío / enviaría / mando la transferencia, el comprobante",
 *    "te confirmo", "te aviso", "consigno", "voy a pagar", "lo separo", "paso por"…) Y un MOMENTO
 *    ("en la tarde", "más tarde", "esta noche", "mañana", "el lunes", "la otra semana", "apenas
 *    llegue / esté", "a fin de mes", "el 15", "quincena", "cuando me paguen"); o
 *  - un ENVÍO DE PAGO ("te envío la transferencia / el comprobante"), aunque no diga cuándo; o
 *  - "cuando me paguen" / "la quincena" (el momento es la acción).
 * Después de esa tanda el cliente solo pudo agradecer o acusar recibo ("Mil gracias", "ok", "sí
 * señora está bien") y una persona tuvo que responderle (si no, el turno es nuestro).
 *
 * La hora de la tarea (horario laboral L–S 8–18, Bogotá), contada desde que lo DIJO:
 *  - "en la tarde" / "esta tarde" → hoy 15:00 (si ya pasó, la siguiente apertura);
 *  - "mañana" → mañana 10:00 ("mañana en la tarde" → mañana 15:00; "pasado mañana" → +2 días 10:00);
 *  - "en la mañana" → hoy 10:00 si todavía no pasó, si no mañana 10:00;
 *  - "esta noche" → la siguiente apertura;
 *  - "más tarde" → +3 h; "ahorita" / "en un rato" → +2 h;
 *  - "el lunes" … "el sábado" → ese día 10:00 (el domingo corre al lunes 8:00);
 *  - "la otra semana" → el lunes siguiente 10:00;
 *  - "a fin de mes" → el 30 (o el último día) 10:00; "quincena" → el 15 o el 30 que sigue, 10:00;
 *    "el 15" → ese día del mes 10:00 (o del mes siguiente si ya pasó);
 *  - sin momento claro ("apenas llegue", "cuando me paguen", "te envío el comprobante") → +24 h.
 * Lo que cae fuera del horario laboral corre a la siguiente apertura.
 */

import { esAgradecimientoSinPendiente, normalizarParaCierre } from "../../../lib/cierre-de-conversacion";
import { siguienteHoraLaboral, type Horario } from "./formulario";

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const BOGOTA = 5 * HORA;

/** Lo mínimo de un mensaje que hace falta (compatible con MensajeCrudo del motor). */
export type MensajeDelCompromiso = {
  direccion: "IN" | "OUT";
  tipo: string;
  texto: string | null;
  en: Date;
  /** rawPayload.source: manual / instance = persona. */
  origen: string | null;
};

export type Compromiso = {
  /** Cuándo lo dijo (el último mensaje de la tanda del compromiso). */
  dichoEn: Date;
  /** Lo que escribió el cliente (la tanda, recortada). */
  frase: string;
  /** El momento en palabras ("en la tarde", "mañana", "el lunes"…; "sin momento claro"). */
  como: string;
  /** La hora de la tarea (en horario laboral). */
  vence: Date;
  /** Mencionó pago / transferencia / anticipo / comprobante (prioridad A). */
  pago: boolean;
  /** Sin momento claro: +24 h. */
  ambiguo: boolean;
};

/* ---------------------------------------------------------------------------------------------- */
/* Palabras (sobre el texto normalizado: minúsculas, sin tildes, "ñ" → "n", sin signos). */

/** Acción del cliente a futuro. */
const ACCION = new RegExp(
  [
    "\\b(te|le|les|se lo|se la|ya te|yo te) (confirmo|confirmaria|confirmare|aviso|avisaria|avisare|escribo|escribiria|escribire|envio|enviaria|enviare|mando|mandaria|mandare|paso|pasaria|pasare|consigno|consignaria|transfiero|transferiria|llamo|llamaria|marco|hablo|digo|diria|cuento|respondo|contesto|separo|abono|pago|pagaria|pagare|giro|hago)\\b",
    "\\b(voy a|vamos a|iria a|ire a|va a|van a|vengo a|paso a) (pagar|consignar|transferir|separar|apartar|comprar|pedir|abonar|enviar|mandar|pasar|ir|llamar|confirmar|hablar|escribir|decidir|mirar|revisar|recoger|hacer)\\b",
    "\\b(consigno|consignaria|consignare|transfiero|transferiria|transferire|pagaria|pagare|abonaria|abonare|separaria|compraria|comprare|pediria|pedire|lo separo|la separo|lo compro|la compro|lo pido|la pido|paso por|pasaria por|hago (el pedido|la transferencia|el pago|la consignacion|el abono))\\b",
  ].join("|"),
);

/** Envío de un pago: compromiso aunque no diga cuándo. */
const ENVIO_DE_PAGO =
  /\b(te|le|les)? ?(envio|enviaria|enviare|mando|mandaria|mandare|paso|pasaria|hago|haria|consigno|consignaria)\b(\s+\w+){0,3}\s+(la transferencia|el comprobante|la consignacion|el pago|el anticipo|el abono|el soporte|el pantallazo|la plata|el dinero)\b/;

/** Mención de pago (prioridad A). */
const MENCIONA_PAGO = /\b(transferenc\w*|transferi\w*|comprobante|consign\w*|anticipo|abon\w*|pag(o|ar|aria|are|ue|uen)|50|mitad|deposit\w*|nequi|daviplata|soporte de pago)\b/;

/** Momentos que por sí solos son compromiso (la acción va implícita). */
const MOMENTO_QUE_COMPROMETE = /\b(cuando me (paguen|consignen|llegue la plata|llegue el pago)|(en|para|con) la quincena|apenas me paguen|cuando reciba (la plata|el pago|mi pago))\b/;

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

/** Acuses que no cambian lo que quedó ("Mil gracias", "Sí señora, está bien", "ok", 👍). */
const PALABRAS_DE_ACUSE = new Set([
  "si", "sii", "siii", "ok", "okey", "okay", "oki", "okis", "listo", "dale", "vale", "bueno", "perfecto", "claro", "de", "una",
  "entendido", "super", "genial", "esta", "bien", "va", "sisas", "senora", "senor", "senorita", "amiga", "gracias", "mil",
  "muchas", "muy", "amable", "excelente", "con", "gusto", "igualmente", "que", "dios", "la", "le", "te", "bendiga", "bendiciones",
  "a", "ti", "usted", "hasta", "luego", "pronto", "chao", "y", "mi", "reina", "querida", "vecina", "ya", "ahi", "estamos", "quedamos",
  "asi", "seria", "sera", "pues", "jaja", "jajaja", "ah", "eh", "hola", "buenas", "tardes", "noches", "dias",
]);

const TIPOS_DE_ACUSE = ["STICKER", "REACTION"];

/** ¿El mensaje del cliente solo agradece o acusa recibo? */
export function esAcuseDelCliente(m: Pick<MensajeDelCompromiso, "tipo" | "texto">): boolean {
  if (TIPOS_DE_ACUSE.includes(m.tipo)) return true;
  const texto = (m.texto ?? "").trim();
  if (!texto) return m.tipo === "TEXT"; // un emoji suelto
  if (/[?¿]/.test(texto)) return false;
  if (esAgradecimientoSinPendiente(texto)) return true;
  const limpio = normalizarParaCierre(texto);
  if (!limpio) return true; // solo emojis / signos
  const palabras = limpio.split(" ");
  return palabras.length <= 8 && palabras.every((p) => PALABRAS_DE_ACUSE.has(p) || /^j[aej]+$/.test(p));
}

/* ---------------------------------------------------------------------------------------------- */
/* Fechas en Bogotá. */

function partes(fecha: Date): { anio: number; mes: number; dia: number; hora: number; semana: number } {
  const b = new Date(fecha.getTime() - BOGOTA);
  return { anio: b.getUTCFullYear(), mes: b.getUTCMonth(), dia: b.getUTCDate(), hora: b.getUTCHours() + b.getUTCMinutes() / 60, semana: b.getUTCDay() };
}

/** Ese día (Bogotá; se aceptan desbordes de día/mes) a la hora dada. */
function aLas(anio: number, mes: number, dia: number, hora: number): Date {
  return new Date(Date.UTC(anio, mes, dia, hora, 0, 0) + BOGOTA);
}

function ultimoDiaDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
}

/** El día `dia` del mes (o el último si no existe) a las 10:00, este mes o el siguiente si ya pasó. */
function diaDelMes(dicho: Date, dia: number): Date {
  const p = partes(dicho);
  const este = aLas(p.anio, p.mes, Math.min(dia, ultimoDiaDelMes(p.anio, p.mes)), 10);
  if (este.getTime() > dicho.getTime()) return este;
  return aLas(p.anio, p.mes + 1, Math.min(dia, ultimoDiaDelMes(p.anio, p.mes + 1)), 10);
}

type Momento = { como: string; cuando: (dicho: Date, horario: Horario) => Date; ambiguo?: boolean };

function siguienteApertura(dicho: Date, horario: Horario): Date {
  const p = partes(dicho);
  return siguienteHoraLaboral(aLas(p.anio, p.mes, p.dia + 1, horario.desde), horario);
}

/** Los momentos, del más específico al más general (gana el primero que aparece en la lista). */
const MOMENTOS: Array<{ re: RegExp; momento: (m: RegExpExecArray) => Momento }> = [
  {
    re: /\bpasado manana\b/,
    momento: () => ({ como: "pasado mañana", cuando: (d) => { const p = partes(d); return aLas(p.anio, p.mes, p.dia + 2, 10); } }),
  },
  {
    re: /\bmanana (en|por) la tarde\b/,
    momento: () => ({ como: "mañana en la tarde", cuando: (d) => { const p = partes(d); return aLas(p.anio, p.mes, p.dia + 1, 15); } }),
  },
  {
    re: /(?<!\b(en|por|de) la )(?<!\besta )\bmanana\b/,
    momento: () => ({ como: "mañana", cuando: (d) => { const p = partes(d); return aLas(p.anio, p.mes, p.dia + 1, 10); } }),
  },
  {
    re: /\b(en|por|esta|hoy en|hoy por) (la )?tarde\b|\besta tarde\b|\bhoy en la tarde\b/,
    momento: () => ({
      como: "en la tarde",
      cuando: (d, h) => {
        const p = partes(d);
        const hoy = aLas(p.anio, p.mes, p.dia, 15);
        return hoy.getTime() > d.getTime() ? hoy : siguienteApertura(d, h);
      },
    }),
  },
  {
    re: /\b(en|por) la manana\b|\besta manana\b/,
    momento: () => ({
      como: "en la mañana",
      cuando: (d) => {
        const p = partes(d);
        const hoy = aLas(p.anio, p.mes, p.dia, 10);
        return hoy.getTime() > d.getTime() ? hoy : aLas(p.anio, p.mes, p.dia + 1, 10);
      },
    }),
  },
  {
    re: /\b(esta|en la|por la|hoy en la) noche\b/,
    momento: () => ({ como: "esta noche", cuando: (d, h) => siguienteApertura(d, h) }),
  },
  {
    re: /\bmas tarde\b|\bmas tardecito\b|\bal rato\b/,
    momento: () => ({ como: "más tarde", cuando: (d) => new Date(d.getTime() + 3 * HORA) }),
  },
  {
    re: /\b(ahorita|ahora en un rato|en un rato|en un ratico|en un momento|en un momentico)\b/,
    momento: () => ({ como: "en un rato", cuando: (d) => new Date(d.getTime() + 2 * HORA) }),
  },
  {
    re: /\b(el|este|el proximo|el otro|para el|hasta el) (lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/,
    momento: (m) => {
      const objetivo = DIAS_SEMANA.indexOf(m[2]);
      return {
        como: `el ${m[2].replace("miercoles", "miércoles").replace("sabado", "sábado")}`,
        cuando: (d) => {
          const p = partes(d);
          const faltan = ((objetivo - p.semana + 7) % 7) || 7;
          return aLas(p.anio, p.mes, p.dia + faltan, 10);
        },
      };
    },
  },
  {
    re: /\b(la|para la) (otra|proxima|siguiente) semana\b|\bla semana que viene\b/,
    momento: () => ({
      como: "la otra semana",
      cuando: (d) => {
        const p = partes(d);
        const faltan = ((1 - p.semana + 7) % 7) || 7;
        return aLas(p.anio, p.mes, p.dia + faltan, 10);
      },
    }),
  },
  {
    re: /\b(a |al |para )?(fin|final|finales) de(l)? mes\b/,
    momento: () => ({ como: "a fin de mes", cuando: (d) => diaDelMes(d, 30) }),
  },
  {
    re: /\bquincena\b/,
    momento: () => ({
      como: "en la quincena",
      cuando: (d) => {
        const quince = diaDelMes(d, 15);
        const treinta = diaDelMes(d, 30);
        return quince.getTime() < treinta.getTime() ? quince : treinta;
      },
    }),
  },
  {
    // "el 15" (no "el 50", ni "el 15 de noviembre": eso es fecha futura; ni "el 15%").
    re: /\b(el|para el|hasta el) (\d{1,2})\b(?! (de|del) (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b)(?! ?(mil|k|por ciento|millon|pesos))/,
    momento: (m) => {
      const dia = Number(m[2]);
      return dia >= 1 && dia <= 31
        ? { como: `el ${dia}`, cuando: (d) => diaDelMes(d, dia) }
        : { como: "", cuando: (d) => d, ambiguo: true };
    },
  },
  {
    re: /\b(cuando me (paguen|consignen)|apenas me paguen|cuando reciba)\b/,
    momento: () => ({ como: "cuando le paguen", cuando: (d) => new Date(d.getTime() + DIA), ambiguo: true }),
  },
  {
    re: /\b(apenas|en cuanto|cuando|ni bien) (llegue|lleguemos|este|estemos|ella este|el este|tenga|pueda|salga|me desocupe|vuelva|regrese)\b/,
    momento: () => ({ como: "apenas pudiera", cuando: (d) => new Date(d.getTime() + DIA), ambiguo: true }),
  },
];

function momentoDe(texto: string): Momento | null {
  for (const { re, momento } of MOMENTOS) {
    const m = re.exec(texto);
    if (!m) continue;
    const r = momento(m);
    if (r.como) return r;
  }
  return null;
}

/* ---------------------------------------------------------------------------------------------- */

function recortar(texto: string, maximo = 140): string {
  const t = texto.replace(/\s+/g, " ").trim();
  return t.length <= maximo ? t : `${t.slice(0, maximo - 1).trimEnd()}…`;
}

/** ¿Esta tanda del cliente deja un compromiso? (sin fecha: eso lo pone `detectarCompromiso`). */
export function compromisoEnTexto(texto: string | null | undefined): { momento: Momento | null; pago: boolean } | null {
  const limpio = normalizarParaCierre(texto ?? "");
  if (!limpio) return null;
  const momento = momentoDe(limpio);
  const accion = ACCION.test(limpio);
  const envioDePago = ENVIO_DE_PAGO.test(limpio);
  const pago = MENCIONA_PAGO.test(limpio);
  const comprometeSolo = MOMENTO_QUE_COMPROMETE.test(limpio);
  if (!(envioDePago || comprometeSolo || (accion && momento))) return null;
  return { momento, pago };
}

const esPersona = (m: MensajeDelCompromiso) => m.direccion === "OUT" && (m.origen === "manual" || m.origen === "instance");

/**
 * El compromiso que dejó el cliente al final de la charla, o null. Busca hacia atrás desde su
 * último mensaje (hasta 12 h antes): la tanda con el compromiso puede venir seguida solo de
 * agradecimientos / acuses; cualquier otra cosa del cliente (una pregunta, un tema nuevo, una foto)
 * corta la búsqueda. Una persona tuvo que responderle después del compromiso.
 */
export function detectarCompromiso(input: { mensajes: MensajeDelCompromiso[]; horario: Horario }): Compromiso | null {
  const mensajes = input.mensajes.filter((m) => m.tipo !== "SYSTEM");
  const delCliente = mensajes.filter((m) => m.direccion === "IN");
  const ultimo = delCliente.at(-1);
  if (!ultimo) return null;
  // Tandas del cliente (mensajes seguidos sin nada nuestro en medio), de la más nueva a la más vieja.
  const tandas: MensajeDelCompromiso[][] = [];
  let actual: MensajeDelCompromiso[] = [];
  for (const m of mensajes) {
    if (m.direccion === "IN") {
      actual.push(m);
    } else if (actual.length) {
      tandas.push(actual);
      actual = [];
    }
  }
  if (actual.length) tandas.push(actual);
  const limite = ultimo.en.getTime() - 12 * HORA;
  for (let i = tandas.length - 1; i >= 0; i -= 1) {
    const tanda = tandas[i];
    const fin = tanda[tanda.length - 1].en;
    if (fin.getTime() < limite) return null;
    const texto = tanda.map((m) => (m.texto ?? "").trim()).filter(Boolean).join(" / ");
    const hallado = compromisoEnTexto(texto);
    if (hallado) {
      // Una persona le respondió después (si no, el cliente espera: el turno es nuestro).
      if (!mensajes.some((m) => esPersona(m) && m.en.getTime() > fin.getTime())) return null;
      const momento = hallado.momento;
      const ambiguo = !momento || Boolean(momento.ambiguo);
      const bruto = momento && !momento.ambiguo ? momento.cuando(fin, input.horario) : new Date(fin.getTime() + DIA);
      // Nunca antes de 1 h después de lo dicho (deja que la persona cierre la charla).
      const minimo = new Date(fin.getTime() + HORA);
      const vence = siguienteHoraLaboral(bruto.getTime() < minimo.getTime() ? minimo : bruto, input.horario);
      return {
        dichoEn: fin,
        frase: recortar(texto),
        como: momento?.como ?? "sin momento claro",
        vence,
        pago: hallado.pago,
        ambiguo,
      };
    }
    // Solo agradecimientos / acuses pueden venir después del compromiso.
    if (!tanda.every(esAcuseDelCliente)) return null;
  }
  return null;
}

/** "¡Hola, Ana! 😊 Te escribo por lo que quedamos: …. ¿Te ayudo con algo para completarlo?" */
export function mensajeDeCompromiso(compromiso: Pick<Compromiso, "frase" | "como" | "pago" | "ambiguo">, nombre: string | null): string {
  const limpio = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  const saludo = limpio && /^[\p{L}]{2,20}$/u.test(limpio) ? `¡Hola, ${limpio[0].toUpperCase()}${limpio.slice(1).toLowerCase()}!` : "¡Hola!";
  const t = normalizarParaCierre(compromiso.frase);
  const cuando = compromiso.ambiguo ? "" : ` ${compromiso.como}`;
  let que: string;
  if (/\btransferenc|\btransferi/.test(t)) que = `la transferencia que me ibas a enviar${cuando}`;
  else if (/\bcomprobante|\bsoporte|\bpantallazo/.test(t)) que = `el comprobante que me ibas a enviar${cuando}`;
  else if (/\bconsign/.test(t)) que = `la consignación que ibas a hacer${cuando}`;
  else if (compromiso.pago) que = `el pago que ibas a hacer${cuando}`;
  else que = `lo que me ibas a confirmar${cuando}`;
  return `${saludo} 😊 Te escribo por lo que quedamos: ${que}. ¿Te ayudo con algo para completarlo?`;
}
