/**
 * EL PRODUCTO QUE LE INTERESA AL LEAD y el MENSAJE ÚTIL que le corresponde (código puro).
 *
 * El seguimiento deja de ser "el mismo texto para todos": si preguntó por butacos de manicure, lo
 * útil es el catálogo de butacos; si es el combo, el video del combo armado con la forma de pago
 * 50/50. Las familias salen de los catálogos (flujos) que ya usa el libro V3; cada una tiene su
 * recurso por defecto y se puede cambiar en la configuración (`recursos`).
 *
 * Reglas de texto (decisiones de Alexander, Tabla de envíos v1 y política de contraentrega):
 * nada de "envío gratis" ni "contraentrega" en lo automático. Por eso el combo NO reutiliza el flujo
 * "Video combo armado" (su texto ofrece contraentrega): manda el mismo video con texto propio.
 */

import { normalizarConservando } from "../../embudo/dominio/senales";

export type Recurso =
  /** Manda un flujo del CRM (catálogo con fotos). */
  | { tipo: "flujo"; flujoId: string; titulo: string; textoSiYaLoVio: string }
  /** Manda un video (o foto) con texto propio. */
  | { tipo: "media"; mediaTipo: "VIDEO" | "IMAGE"; mediaUrl: string; texto: string; textoSiYaLoVio: string }
  /** Solo un texto. */
  | { tipo: "texto"; texto: string };

export type Familia = {
  clave: string;
  nombre: string;
  /** Sobre el texto en minúsculas y sin tildes. */
  patrones: RegExp[];
};

const FLUJO = (id: string) => `evolution:cmre8u9r9002g2gp1fqlzrsdj:${id}`;
const YA_LO_VIO = (cosa: string) => `¿Cuál de ${cosa} te gustó más? 😊 Te confirmo el precio y el envío a tu ciudad.`;

/** En orden: la primera que encaja gana ("combo mesa y sillas manicure" es mesa, no butaco). */
export const FAMILIAS: Familia[] = [
  {
    clave: "combo-camilla",
    nombre: "Combo de Camilla",
    patrones: [/\bcombo\b[^.?!]{0,40}\b(camill|estetica|spa)/, /\bcamill\w*[^.?!]{0,40}\bcombo\b/, /\bcombo (de )?(camillas?|estetica)\b/],
  },
  { clave: "mesa-manicure", nombre: "mesa de manicure", patrones: [/\bmesas? (de |para )?(la )?(manicur\w*|unas|una|manos)\b/, /\bmesas? y sillas?\b/, /\bpuesto de unas\b/] },
  {
    clave: "butacos-manicure",
    nombre: "butacos de manicure",
    patrones: [
      /\bbutac\w*/,
      /\b(silla|sillas|cadeira|cadeiras|silleta|silletas) (de |para |da |pra )?(la |el )?(manicur\w*|pedicur\w*|mani|pedi|unas|manicurista|clienta)\b/,
      /\bsillas? auxiliar\w*/,
      /\bmani y pedi\b|\bmani pedi\b/,
    ],
  },
  { clave: "poltronas", nombre: "poltronas", patrones: [/\bpoltron\w*/, /\btrono\b/, /\bsillon\w* (de |para )?(spa|pedicur\w*)/] },
  { clave: "lavacabezas", nombre: "lavacabezas", patrones: [/\blava ?cabeza\w*/, /\bunidad de lavado\b/, /\bpoceta\b/] },
  {
    clave: "sillas-peluqueria",
    nombre: "sillas de peluquería",
    patrones: [/\bsillas? (hidraulic\w*|neumatic\w*|barber\w*|de peluquer\w*|para peluquer\w*|de corte|para (motilar|cortar))/, /\bbarberi\w*/, /\bsilla de barbero\b/],
  },
  { clave: "auxiliares", nombre: "auxiliares de peluquería", patrones: [/\bcarrit\w*/, /\besmalter\w*/, /\bauxiliar\w* de peluquer\w*/, /\borganizador\w*/] },
  { clave: "camillas", nombre: "camillas", patrones: [/\bcamill\w*/, /\bdivan\b/] },
  { clave: "tocador", nombre: "tocador", patrones: [/\btocador\w*/, /\bespejo\w*/] },
  { clave: "sofa-recepcion", nombre: "sofá o recepción", patrones: [/\bsofa\w*/, /\brecepcion\b/] },
];

const POR_CLAVE = new Map(FAMILIAS.map((familia) => [familia.clave, familia]));

export function nombreDeFamilia(clave: string | null | undefined): string | null {
  return clave ? POR_CLAVE.get(clave)?.nombre ?? clave : null;
}

/** La familia que nombra un texto (mensaje del cliente o nombre del producto del V3). */
export function familiaDelTexto(texto: string | null | undefined): string | null {
  const normal = normalizarConservando(texto ?? "").replace(/\s+/g, " ");
  if (!normal.trim()) return null;
  for (const familia of FAMILIAS) {
    if (familia.patrones.some((patron) => patron.test(normal))) return familia.clave;
  }
  return null;
}

/** El video del combo armado (el mismo del flujo "Video combo armado", sin su texto de contraentrega). */
export const VIDEO_COMBO_ARMADO =
  "https://app.aizenbot.com/uploads/chatbot-flows/1790998704867-WhatsApp_Video_2026-10-02_at_103757_PM.mp4";

export const RECURSOS_POR_DEFECTO: Record<string, Recurso> = {
  "combo-camilla": {
    tipo: "media",
    mediaTipo: "VIDEO",
    mediaUrl: VIDEO_COMBO_ARMADO,
    texto:
      "Así se ve el *combo armado*, listo para trabajar 💛 Lo separas con el *50 %* y el otro *50 %* lo pagas cuando esté terminado, después de enviarte *fotos y video* 📦 ¿En qué *color* te lo dejo?",
    textoSiYaLoVio:
      "Lo separas con el *50 %* y el otro *50 %* lo pagas cuando esté terminado, después de enviarte *fotos y video* 📦 ¿En qué *color* te lo dejo?",
  },
  camillas: { tipo: "flujo", flujoId: FLUJO("workflow-1783979965858-90y6l"), titulo: "Catálogo de camillas", textoSiYaLoVio: YA_LO_VIO("las *camillas*") },
  "butacos-manicure": { tipo: "flujo", flujoId: FLUJO("workflow-1783965130062-fmhd0"), titulo: "Catálogo de butacos mani-pedi", textoSiYaLoVio: YA_LO_VIO("los *butacos*") },
  "mesa-manicure": { tipo: "flujo", flujoId: FLUJO("workflow-1783979643091-awd0l"), titulo: "Mesa de manicure + combo", textoSiYaLoVio: YA_LO_VIO("las *mesas de manicure*") },
  "sillas-peluqueria": { tipo: "flujo", flujoId: FLUJO("workflow-1783722698643-zx11e"), titulo: "Catálogo de sillas", textoSiYaLoVio: YA_LO_VIO("las *sillas*") },
  lavacabezas: { tipo: "flujo", flujoId: FLUJO("workflow-1783953464990-tbl8b"), titulo: "Catálogo de lavacabezas", textoSiYaLoVio: YA_LO_VIO("los *lavacabezas*") },
  poltronas: { tipo: "flujo", flujoId: FLUJO("workflow-1783964366775-3jfh3"), titulo: "Catálogo de poltronas", textoSiYaLoVio: YA_LO_VIO("las *poltronas*") },
  auxiliares: { tipo: "flujo", flujoId: FLUJO("workflow-1783980685033-pab2r"), titulo: "Catálogo de auxiliares", textoSiYaLoVio: YA_LO_VIO("los *auxiliares*") },
};

/** Frases que nunca salen en un automático (política vigente). */
const PROHIBIDO = /contra ?entrega|env[ií]o gratis|gratis/i;

export function textoPermitido(texto: string): boolean {
  return !PROHIBIDO.test(texto);
}

export type MensajeUtil = {
  familia: string;
  /** Lo que se agenda: un flujo, o media + texto, o solo texto. */
  acciones: Array<{ messageType: "TEXT" | "VIDEO" | "IMAGE"; content: string | null; mediaUrl?: string | null; flowId?: string | null }>;
  resumen: string;
};

/**
 * El mensaje útil para esa familia. Si el cliente YA vio el recurso (el flujo salió, o el video ya
 * está en el chat), sale solo el texto corto de "¿cuál te gustó?". Null si la familia no tiene
 * recurso o el texto rompe la política.
 */
export function mensajeUtilPara(input: {
  familia: string | null;
  recursos: Record<string, Recurso>;
  flujosEnviados: string[];
  mediasEnviadas: string[];
}): MensajeUtil | null {
  if (!input.familia) return null;
  const recurso = input.recursos[input.familia];
  if (!recurso) return null;
  let salida: MensajeUtil;
  if (recurso.tipo === "flujo") {
    salida = input.flujosEnviados.includes(recurso.flujoId)
      ? { familia: input.familia, acciones: [{ messageType: "TEXT", content: recurso.textoSiYaLoVio }], resumen: "texto (ya vio el catálogo)" }
      : { familia: input.familia, acciones: [{ messageType: "TEXT", content: recurso.titulo, flowId: recurso.flujoId }], resumen: recurso.titulo };
  } else if (recurso.tipo === "media") {
    const archivo = recurso.mediaUrl.split("/").pop() ?? recurso.mediaUrl;
    const yaSalio = input.mediasEnviadas.some((media) => media && (media.endsWith(archivo) || archivo.endsWith(media)));
    salida = yaSalio
      ? { familia: input.familia, acciones: [{ messageType: "TEXT", content: recurso.textoSiYaLoVio }], resumen: "texto 50/50 (ya vio el video)" }
      : {
          familia: input.familia,
          acciones: [
            { messageType: recurso.mediaTipo, content: null, mediaUrl: recurso.mediaUrl },
            { messageType: "TEXT", content: recurso.texto },
          ],
          resumen: recurso.mediaTipo === "VIDEO" ? "video + texto 50/50" : "foto + texto",
        };
  } else {
    salida = { familia: input.familia, acciones: [{ messageType: "TEXT", content: recurso.texto }], resumen: "texto" };
  }
  const textos = salida.acciones.filter((accion) => !accion.flowId).map((accion) => accion.content ?? "");
  return textos.every(textoPermitido) ? salida : null;
}
