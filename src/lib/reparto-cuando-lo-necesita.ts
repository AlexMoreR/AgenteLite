import { departamentoDeCiudad, limpiarTexto } from "../features/pauta/dominio/departamentos";

/*
  ¿EL CHAT NECESITA ASESORA? (Alex, 11-nov-2026, pisa la regla del 30-10 de "asignar apenas responde
  la bienvenida"). Caso: chat 253948799807545, la clienta contestó "estética facial" a las 10:01 p. m.
  y Yair quedó asignado en ese instante, con el bot todavía calificando.

  La regla nueva:
    (a) Si el agente pidió asesora (la nota "El agente pide un asesor: …"), se asigna SIEMPRE, con o
        sin fotos: el bot se rindió y si nadie la toma la clienta queda sin respuesta. Caso real del
        11-11 (cv70a2c874fc1e084c485c2ac5): "Quiropodia", el bot "no pudo redactar una respuesta" y
        todavía no había mandado fotos.
    (b) Lo que escribe la clienta NO asigna antes de que el bot mande las fotos (una foto, un video o
        un catálogo PDF salientes): con la bienvenida y "qué servicios ofreces" todavía no. Con las
        fotos ya mandadas, asigna si pregunta precio, pago, envío o contraentrega, o dice su ciudad.
  La reasignación a los 10 minutos sin respuesta (demora-de-asesora) no cambia.

  Código puro (sin base): lo usan el reparto por turno (al entrar cada mensaje) y el rescate de
  chats sin asesora (cada minuto, así lo que pasó DESPUÉS del mensaje de la clienta —las fotos, la
  nota del agente— también se ve). Pruebas: npm run test:reparto-cuando-lo-necesita.

  Es el primer paso de la T-772 (autoasignación configurable): esa tarjeta le agrega los
  interruptores, la pantalla y el MCP sobre este mismo archivo.
*/

export type MensajeDelReparto = {
  direction: string;
  type?: string | null;
  content?: string | null;
  createdAt?: Date | string | number | null;
  borrado?: boolean;
};

const TIPOS_DE_FOTOS = new Set(["IMAGE", "VIDEO", "DOCUMENT"]);
const NOTA_PIDE_ASESOR = /^El agente pide un asesor\b/i;

/*
  (b) Plata y entrega, sobre el texto sin tildes y en minúscula. Palabras enteras: "pago" sí,
  "pagina" no. "llega" o "demora" solas no: "¿cuándo llega?" puede ser de otra cosa, y el agente
  igual lo escala si no sabe.
*/
const PLATA_O_ENTREGA = new RegExp(
  [
    "precios?",
    "cuanto (?:vale|valen|cuesta|cuestan|sale|salen|es|seria|queda|me sale|me queda)",
    "que (?:valor|precio|costo)",
    "valor",
    "costos?",
    "pagos?",
    "pagar",
    "pago contra ?entrega",
    "formas? de pago",
    "medios? de pago",
    "como (?:pago|se paga|puedo pagar)",
    "nequi",
    "daviplata",
    "bancolombia",
    "transferencia",
    "tarjeta",
    "cuotas",
    "credito",
    "financia\\w*",
    "addi",
    "sistecredito",
    "anticipo",
    "abono",
    "separar\\w*",
    "envios?",
    "enviar\\w*",
    "envian",
    "despach\\w*",
    "domicilio",
    "flete",
    "transportadora",
    "contra ?entrega",
    "contraentregas?",
    "al recibir",
    "ciudad",
    "soy de",
    "vivo en",
  ]
    .map((parte) => `(?:${parte})`)
    .join("|"),
);
const PALABRAS_DE_PLATA = new RegExp(`(?:^| )(?:${PLATA_O_ENTREGA.source})(?: |$)`);

/*
  Ciudades que también son palabras o nombres comunes: solas no cuentan ("quiero un plato",
  "mi meta es…", "me llamo Florencia"). Si la clienta dice "soy de Florencia", entra por "soy de".
*/
const CIUDADES_QUE_SON_PALABRAS = new Set([
  "plato",
  "meta",
  "cesar",
  "florencia",
  "honda",
  "remedios",
  "providencia",
  "animas",
  "candelaria",
  "ginebra",
  "miranda",
  "restrepo",
  "barbosa",
  "palermo",
  "andes",
  "sevilla",
  "caldas",
  "cauca",
  "valle",
  "atrato",
  "bellavista",
  "salamina",
  "granada",
  "montenegro",
  "albania",
  "florida",
  "la union",
  "union",
  "turbo",
  "ricaurte",
  "tame",
]);

/** ¿El texto nombra una ciudad o un departamento de Colombia? Prueba grupos de 1 a 4 palabras. */
export function nombraUnaCiudad(texto: string | null | undefined): boolean {
  const palabras = limpiarTexto(texto).split(" ").filter(Boolean);
  for (let largo = 4; largo >= 1; largo -= 1) {
    for (let inicio = 0; inicio + largo <= palabras.length; inicio += 1) {
      const grupo = palabras.slice(inicio, inicio + largo).join(" ");
      if (grupo.length < 4 || CIUDADES_QUE_SON_PALABRAS.has(grupo)) continue;
      if (departamentoDeCiudad(grupo)) return true;
    }
  }
  return false;
}

/** (b) ¿La clienta pregunta precio, pago, envío o contraentrega, o dice su ciudad? */
export function hablaDePlataOEntrega(texto: string | null | undefined): boolean {
  const limpio = limpiarTexto(texto);
  if (!limpio) return false;
  return PALABRAS_DE_PLATA.test(limpio) || nombraUnaCiudad(texto);
}

function enOrden(mensajes: ReadonlyArray<MensajeDelReparto>): MensajeDelReparto[] {
  return mensajes
    .filter((m) => !m.borrado)
    .map((m, indice) => ({ m, indice, hora: m.createdAt == null ? Number.NaN : new Date(m.createdAt).getTime() }))
    .sort((a, b) => (!Number.isNaN(a.hora) && !Number.isNaN(b.hora) && a.hora !== b.hora ? a.hora - b.hora : a.indice - b.indice))
    .map(({ m }) => m);
}

export type DecisionDelReparto =
  | { asignar: false; motivo: "sin_fotos" | "sin_pedido" }
  | { asignar: true; motivo: "agente_pide_asesora" | "plata_o_entrega"; detalle: string };

/**
 * La regla completa. `mensajes`: los del chat, con las notas del sistema (SYSTEM), en cualquier
 * orden si traen fecha.
 */
export function chatNecesitaAsesora(mensajes: ReadonlyArray<MensajeDelReparto>): DecisionDelReparto {
  const ordenados = enOrden(mensajes);

  // (a) El agente pidió asesora: siempre, haya fotos o no.
  const nota = ordenados.find((m) => (m.type ?? "").toUpperCase() === "SYSTEM" && NOTA_PIDE_ASESOR.test((m.content ?? "").trim()));
  if (nota) return { asignar: true, motivo: "agente_pide_asesora", detalle: (nota.content ?? "").slice(0, 160) };

  const primeraFoto = ordenados.findIndex(
    (m) => m.direction === "OUTBOUND" && TIPOS_DE_FOTOS.has((m.type ?? "TEXT").toUpperCase()),
  );
  if (primeraFoto === -1) return { asignar: false, motivo: "sin_fotos" };

  // (b) Cualquier mensaje de la clienta (también uno de antes de las fotos: "Precio en Bogotá" en el
  // primer mensaje sigue pendiente de respuesta cuando llegan las fotos).
  const pedido = ordenados.find((m) => m.direction === "INBOUND" && hablaDePlataOEntrega(m.content));
  if (pedido) return { asignar: true, motivo: "plata_o_entrega", detalle: (pedido.content ?? "").slice(0, 160) };

  return { asignar: false, motivo: "sin_pedido" };
}
