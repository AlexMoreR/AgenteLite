/**
 * ¿EL CLIENTE ESTÁ EN COLOMBIA? (código puro)
 *
 * Decisión de Alexander (10-10-2026): solo vendemos y enviamos dentro de Colombia. Un lead de otro
 * país se atiende UNA vez con amabilidad y no se le sigue (ni bot, ni asesora, ni seguimientos, ni
 * métricas).
 *
 * El cuidado grande son los LID de WhatsApp: un id interno de 14–15 dígitos que NO es un teléfono.
 * Un LID que empieza por "25" no es Tanzania. Ante la duda, DESCONOCIDO: no se decide.
 *
 * Lo usan el webhook (servicios/exterior.ts), el motor del seguimiento inteligente y el Supervisor.
 */

export type Pais = "CO" | "EXTERIOR" | "DESCONOCIDO";

export type ResultadoDelPais = {
  pais: Pais;
  /** Indicativo aproximado (+55, +1, +593…) para mostrar; null si no se sabe. */
  prefijo: string | null;
};

/** Los países con 3 dígitos de indicativo más comunes en estos chats (Latinoamérica). */
const INDICATIVOS_DE_TRES = ["502", "503", "504", "505", "506", "507", "509", "591", "592", "593", "595", "597", "598", "599"];

/** Países cuyo número completo tiene 13 dígitos (Brasil con 9, Argentina 549, México 521). */
const PREFIJOS_DE_TRECE = ["55", "54", "52"];

function digitos(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "");
}

function indicativo(numero: string): string {
  if (numero.startsWith("1")) return "+1";
  if (numero.startsWith("7")) return "+7";
  const tres = numero.slice(0, 3);
  if (INDICATIVOS_DE_TRES.includes(tres)) return `+${tres}`;
  return `+${numero.slice(0, 2)}`;
}

/**
 * El país de un número guardado.
 *  - `esLid`: el número ES el LID (el webhook lo sabe por el JID; en fichas viejas, por el largo).
 *  - `telefonoDescubierto`: el teléfono real que se le pescó a un contacto LID, si existe.
 */
export function paisDelTelefono(input: {
  telefono: string | null | undefined;
  esLid?: boolean;
  telefonoDescubierto?: string | null;
}): ResultadoDelPais {
  const descubierto = digitos(input.telefonoDescubierto);
  const numero = descubierto.length >= 10 && descubierto.length <= 13 ? descubierto : digitos(input.telefono);
  const usaDescubierto = numero === descubierto && descubierto.length > 0;
  if (!usaDescubierto && input.esLid) return { pais: "DESCONOCIDO", prefijo: null };
  if (numero.length < 10) return { pais: "DESCONOCIDO", prefijo: null };
  // 14 o 15 dígitos: es un LID (ver lib/whatsapp-lid.ts looksLikeLidNumber).
  if (numero.length >= 14) return { pais: "DESCONOCIDO", prefijo: null };
  // Celular colombiano guardado sin indicativo.
  if (numero.length === 10) return numero.startsWith("3") ? { pais: "CO", prefijo: "+57" } : { pais: "DESCONOCIDO", prefijo: null };
  if (numero.startsWith("57")) return numero.length <= 12 ? { pais: "CO", prefijo: "+57" } : { pais: "DESCONOCIDO", prefijo: null };
  if (numero.length === 13) {
    return PREFIJOS_DE_TRECE.some((prefijo) => numero.startsWith(prefijo))
      ? { pais: "EXTERIOR", prefijo: indicativo(numero) }
      : { pais: "DESCONOCIDO", prefijo: null };
  }
  // 11 o 12 dígitos con otro indicativo: Brasil viejo (+55 45…), EE. UU. (+1), Venezuela (+58)…
  return { pais: "EXTERIOR", prefijo: indicativo(numero) };
}

/*
  OJO con los números extranjeros DE CLIENTES EN COLOMBIA. En la simulación del 10-oct (Ventas 1,
  7 días), de 12 leads con indicativo distinto de 57, al menos 5 estaban en Colombia: venezolanos con
  +58, un +1 que escribió "Pereira risaralda", un +52 que preguntó "el envío a Planeta Rica Córdoba",
  dos en etapa Caliente. Por eso un lead que nombra un lugar de Colombia NUNCA se trata como del
  exterior, y si ya estaba marcado, se desmarca.
*/
const LUGARES_DE_COLOMBIA = [
  "colombia", "bogota", "medellin", "cali", "barranquilla", "cartagena", "cucuta", "bucaramanga", "pereira", "manizales",
  "armenia", "ibague", "villavicencio", "santa marta", "pasto", "monteria", "neiva", "valledupar", "sincelejo", "popayan",
  "tunja", "riohacha", "florencia", "quibdo", "yopal", "leticia", "mocoa", "arauca", "san andres", "soacha", "bello",
  "itagui", "envigado", "palmira", "tulua", "buga", "cartago", "buenaventura", "jamundi", "dosquebradas", "girardot",
  "fusagasuga", "zipaquira", "chia", "facatativa", "sogamoso", "duitama", "barrancabermeja", "apartado", "rionegro",
  "planeta rica", "lorica", "cerete", "magangue", "cienaga", "maicao", "aguachica", "ocana", "pamplona", "yumbo",
  "la dorada", "espinal", "caucasia", "sahagun", "tumaco", "ipiales", "girardota", "sabaneta", "soledad", "malambo",
  "antioquia", "atlantico", "bolivar", "boyaca", "caldas", "caqueta", "cauca", "cesar", "choco", "cordoba",
  "cundinamarca", "huila", "guajira", "magdalena", "narino", "norte de santander", "santander", "putumayo", "quindio",
  "risaralda", "sucre", "tolima", "valle del cauca", "casanare", "meta", "guaviare", "vichada", "amazonas",
];
const RE_COLOMBIA = new RegExp(`\\b(${LUGARES_DE_COLOMBIA.map((l) => l.replace(/ /g, "\\s+")).join("|")})\\b`);

/** ¿El texto nombra Colombia o una ciudad o departamento de Colombia? */
export function mencionaColombia(texto: string | null | undefined): boolean {
  const normal = (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return RE_COLOMBIA.test(normal);
}

export type MarcaExterior = { en: string; prefijo: string | null; respuestaEnviada: boolean };

/** La marca que deja el webhook en Contact.metadata.fueraDeColombia. */
export function leerMarcaExterior(metadata: unknown): MarcaExterior | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const marca = (metadata as Record<string, unknown>).fueraDeColombia;
  if (!marca || typeof marca !== "object" || Array.isArray(marca)) return null;
  const fila = marca as Record<string, unknown>;
  return {
    en: typeof fila.en === "string" ? fila.en : "",
    prefijo: typeof fila.prefijo === "string" ? fila.prefijo : null,
    respuestaEnviada: fila.respuestaEnviada === true,
  };
}

/**
 * ¿Este contacto se trata como "fuera de Colombia"? La marca manda; sin marca, el teléfono (si se
 * puede decidir). Lo usa el Supervisor para no alertar por leads que no son nuestros.
 */
export function esDelExterior(input: {
  metadata?: unknown;
  telefono: string | null | undefined;
  esLid?: boolean;
  telefonoDescubierto?: string | null;
  /** Lo que escribió el cliente: si nombra un lugar de Colombia, NO es del exterior. */
  textos?: Array<string | null | undefined>;
}): boolean {
  if (input.textos?.some(mencionaColombia)) return false;
  if (leerMarcaExterior(input.metadata)) return true;
  return paisDelTelefono(input).pais === "EXTERIOR";
}
