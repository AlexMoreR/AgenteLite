import { prisma } from "@/lib/prisma";

import { departamentoDeCiudad, limpiarTexto } from "../features/pauta/dominio/departamentos";
import { respondioLaBienvenida } from "./turno-con-contenido";

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

  DESDE EL 22-NOV-2026 (Alex) la (b) es otra: se asigna apenas la clienta escribe CUALQUIER cosa
  además del mensaje con el que entró (el texto del anuncio o el "¿sigue disponible?" de Marketplace),
  con fotos o sin fotos: una pregunta, la ciudad, un "sí", un audio. En 30 días quedaron 216 chats en
  Nuevo sin asesora que habían escrito precio, fotos o ubicación y nadie los tomó, porque preguntaban
  el precio antes de las fotos o se callaban cuando el bot les pedía la ciudad. En un chat que no
  vino de anuncio ni de Marketplace (orgánico, web) también cuenta el primer mensaje.

  Código puro (sin base): lo usan el reparto por turno (al entrar cada mensaje) y el rescate de
  chats sin asesora (cada minuto, así lo que pasó DESPUÉS del mensaje de la clienta —las fotos, la
  nota del agente— también se ve). Pruebas: npm run test:reparto-cuando-lo-necesita.

  Es el primer paso de la T-772 (autoasignación configurable). La parte 1 de esa tarjeta le agregó
  aquí los interruptores (`ConfigDeAsignacion`) y la regla con entrada completa
  (`elChatNecesitaAsesora`); la pantalla y el MCP vienen en las partes siguientes.
*/

/* ------------------------------------------------------------------------------------------------
   LOS INTERRUPTORES (T-772, parte 1): AppSetting `reparto:cuando:<workspaceId>`, valor en JSON.
   (a) agentePide: la nota "El agente pide un asesor" o la IA pausada asignan.
   (b) clientaPreguntaPlataOEntrega: desde el 22-11 es "la clienta escribe algo además del mensaje
       con el que entró" (el nombre de la clave se deja para no romper lo guardado ni el MCP).
   (c) asesoraEscribe: la asesora que escribe en un chat sin dueña se lo queda (conversation-claim.ts).
   comoAntes: la regla del 30-10 (asignar apenas responde la bienvenida) y nada más.
   Sin fila, con JSON roto o con la base caída: los valores por defecto (a, b y c prendidos).
------------------------------------------------------------------------------------------------ */

export type ConfigDeAsignacion = {
  agentePide: boolean;
  clientaPreguntaPlataOEntrega: boolean;
  asesoraEscribe: boolean;
  comoAntes: boolean;
};

export const CONFIG_DE_ASIGNACION_POR_DEFECTO: Readonly<ConfigDeAsignacion> = Object.freeze({
  agentePide: true,
  clientaPreguntaPlataOEntrega: true,
  asesoraEscribe: true,
  comoAntes: false,
});

const INTERRUPTORES = Object.keys(CONFIG_DE_ASIGNACION_POR_DEFECTO) as Array<keyof ConfigDeAsignacion>;

export const claveConfigDeAsignacion = (workspaceId: string) => `reparto:cuando:${workspaceId}`;

/** Cada interruptor que venga como true/false (o "true"/"false"); lo demás, el valor por defecto. */
export function completarConfigDeAsignacion(valor: unknown): ConfigDeAsignacion {
  const config: ConfigDeAsignacion = { ...CONFIG_DE_ASIGNACION_POR_DEFECTO };
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return config;
  const crudo = valor as Record<string, unknown>;
  for (const clave of INTERRUPTORES) {
    const v = crudo[clave];
    if (v === true || v === "true") config[clave] = true;
    else if (v === false || v === "false") config[clave] = false;
  }
  return config;
}

export function leerConfigDeAsignacionDeTexto(texto: string | null | undefined): ConfigDeAsignacion {
  try {
    return completarConfigDeAsignacion(texto ? JSON.parse(texto) : null);
  } catch {
    // JSON roto: los valores por defecto.
    return { ...CONFIG_DE_ASIGNACION_POR_DEFECTO };
  }
}

/** Un minuto de memoria por proceso, igual que reparto-config.ts. */
const MEMORIA_MS = 60_000;
const configsDeAsignacion = new Map<string, { valor: ConfigDeAsignacion; vence: number }>();

export async function leerConfigDeAsignacion(workspaceId: string): Promise<ConfigDeAsignacion> {
  const guardado = configsDeAsignacion.get(workspaceId);
  if (guardado && guardado.vence > Date.now()) return { ...guardado.valor };
  let valor: ConfigDeAsignacion;
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: claveConfigDeAsignacion(workspaceId) } });
    valor = leerConfigDeAsignacionDeTexto(fila?.value);
  } catch {
    valor = { ...CONFIG_DE_ASIGNACION_POR_DEFECTO };
  }
  configsDeAsignacion.set(workspaceId, { valor, vence: Date.now() + MEMORIA_MS });
  return { ...valor };
}

/** Guarda los interruptores (lo que falte o no sea true/false queda con el valor por defecto). */
export async function guardarConfigDeAsignacion(
  workspaceId: string,
  config: Partial<ConfigDeAsignacion>,
): Promise<ConfigDeAsignacion> {
  if (!workspaceId) throw new Error("Falta el negocio");
  const valor = completarConfigDeAsignacion(config);
  const texto = JSON.stringify(valor);
  const key = claveConfigDeAsignacion(workspaceId);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: texto }, update: { value: texto } });
  configsDeAsignacion.delete(workspaceId);
  return valor;
}

/** Para las pruebas: olvida lo leído. */
export function olvidarConfigsDeAsignacion() {
  configsDeAsignacion.clear();
}

export type MensajeDelReparto = {
  direction: string;
  type?: string | null;
  content?: string | null;
  createdAt?: Date | string | number | null;
  borrado?: boolean;
};

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
  | { asignar: false; motivo: "sin_pedido" | "sin_respuesta" }
  | {
      asignar: true;
      motivo: "agente_pide_asesora" | "ia_pausada" | "clienta_escribio" | "respondio_la_bienvenida";
      detalle: string;
    };

/** ¿Hay una nota del sistema "El agente pide un asesor: …"? Devuelve la nota (o null). */
export function notaDelAgentePideAsesor(mensajes: ReadonlyArray<MensajeDelReparto>): MensajeDelReparto | null {
  return (
    enOrden(mensajes).find(
      (m) => (m.type ?? "").toUpperCase() === "SYSTEM" && NOTA_PIDE_ASESOR.test((m.content ?? "").trim()),
    ) ?? null
  );
}

/** La IA pausada cuenta como "el agente pide", salvo si la pausó un bloqueo o el contacto está oculto del CRM. */
export function iaPausadaPorElChat(conversacion: {
  automationPaused?: boolean | null;
  contact?: { bloqueadoEn?: Date | null; excludedFromCrm?: boolean | null } | null;
}): boolean {
  return Boolean(conversacion.automationPaused && !conversacion.contact?.bloqueadoEn && !conversacion.contact?.excludedFromCrm);
}

export type EntradaDeLaRegla = {
  /** Los del chat, con las notas del sistema (SYSTEM), en cualquier orden si traen fecha. */
  mensajes: ReadonlyArray<MensajeDelReparto>;
  /** Sin config: los valores por defecto. */
  config?: Partial<ConfigDeAsignacion> | null;
  /** Sin dato: se busca la nota en `mensajes`. */
  agentePidioAsesor?: boolean;
  /** La IA del chat está pausada (`automationPaused`). */
  iaPausada?: boolean;
  /**
   * El primer mensaje de la clienta es el de ENTRADA (texto del anuncio o de Marketplace) y no
   * cuenta para asignar. Sin dato: sí (lo prudente). En un chat orgánico o de la web es false.
   */
  primerMensajeEsDeEntrada?: boolean;
};

/** Lo que manda la clienta y cuenta como "escribió": todo menos las notas y lo borrado. */
const NO_CUENTA_COMO_ESCRIBIR = new Set(["SYSTEM"]);

/**
 * ¿El chat vino de un anuncio de Meta o de Marketplace? Entonces el primer mensaje de la clienta es
 * el texto ya escrito del anuncio o el "¿sigue disponible?" y no cuenta. Lee lo mismo que
 * origen-del-cliente.ts (Contact.metadata) y la línea: una línea de Marketplace también.
 */
export function primerMensajeEsDeEntrada(input: { metadataContacto: unknown; lineaEsMarketplace?: boolean }): boolean {
  if (input.lineaEsMarketplace) return true;
  const meta =
    input.metadataContacto && typeof input.metadataContacto === "object" && !Array.isArray(input.metadataContacto)
      ? (input.metadataContacto as Record<string, unknown>)
      : {};
  const texto = (valor: unknown) => (typeof valor === "string" ? valor.trim().toLowerCase() : "");
  const origen = meta.origen && typeof meta.origen === "object" ? (meta.origen as Record<string, unknown>) : {};
  return Boolean(texto(meta.adCapturedAt)) || texto(meta.source) === "meta ads" || texto(origen.canal) === "marketplace";
}

/** Los mensajes de la clienta que cuentan para "escribió algo además del de entrada". */
export function mensajesQueCuentan(
  mensajes: ReadonlyArray<MensajeDelReparto>,
  primeroEsDeEntrada = true,
): MensajeDelReparto[] {
  const deLaClienta = enOrden(mensajes).filter(
    (m) => m.direction === "INBOUND" && !NO_CUENTA_COMO_ESCRIBIR.has((m.type ?? "TEXT").toUpperCase()),
  );
  return primeroEsDeEntrada ? deLaClienta.slice(1) : deLaClienta;
}

/** La regla completa, con el motivo (para el log). */
export function decidirSiElChatNecesitaAsesora(entrada: EntradaDeLaRegla): DecisionDelReparto {
  const config = completarConfigDeAsignacion(entrada.config ?? null);
  const { mensajes } = entrada;

  // comoAntes: la regla del 30-10, sin mirar nada más.
  if (config.comoAntes) {
    return respondioLaBienvenida(mensajes)
      ? { asignar: true, motivo: "respondio_la_bienvenida", detalle: "" }
      : { asignar: false, motivo: "sin_respuesta" };
  }

  // (a) El agente pidió asesora o la IA está pausada: siempre, haya fotos o no.
  if (config.agentePide) {
    const nota = notaDelAgentePideAsesor(mensajes);
    const pidio = entrada.agentePidioAsesor ?? Boolean(nota);
    if (pidio) {
      return { asignar: true, motivo: "agente_pide_asesora", detalle: (nota?.content ?? "").slice(0, 160) };
    }
    if (entrada.iaPausada) return { asignar: true, motivo: "ia_pausada", detalle: "" };
  }

  // (b) Desde el 22-11: la clienta escribió algo además del mensaje con el que entró, haya fotos o no.
  if (config.clientaPreguntaPlataOEntrega) {
    const [escribio] = mensajesQueCuentan(mensajes, entrada.primerMensajeEsDeEntrada ?? true);
    if (escribio) {
      return {
        asignar: true,
        motivo: "clienta_escribio",
        detalle: (escribio.content ?? (escribio.type ?? "").toLowerCase()).slice(0, 160),
      };
    }
  }

  return { asignar: false, motivo: "sin_pedido" };
}

/** ¿El chat necesita asesora? La regla de la T-772 (reparto por turno y rescate de los 30 min). */
export function elChatNecesitaAsesora(entrada: EntradaDeLaRegla): boolean {
  return decidirSiElChatNecesitaAsesora(entrada).asignar;
}

/** La regla del 11-11 con los valores por defecto, buscando la nota en los mensajes. */
export function chatNecesitaAsesora(mensajes: ReadonlyArray<MensajeDelReparto>): DecisionDelReparto {
  return decidirSiElChatNecesitaAsesora({ mensajes });
}
