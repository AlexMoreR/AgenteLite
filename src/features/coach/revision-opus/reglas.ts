// Reglas del Coach con Opus (parte 1, 3-nov-2026): qué se acepta en una revisión diaria y cómo se
// escribe el aviso a la asesora y al dueño. Funciones puras, sin Prisma ni red: las prueba
// scripts/check-coach-opus.mjs. El servicio (servicio.ts) valida con esto antes de guardar.
//
// "El Coach enseña, no castiga": a la asesora no se le mencionan los chats que se cayeron por el bot
// o por una política del negocio; esos los ve solo el dueño.

export const CAUSAS = ["asesora", "bot", "politica", "cliente_sin_intencion"] as const;
export type CausaCoach = (typeof CAUSAS)[number];

export const TIPOS_DE_CHAT = ["bien", "mejorable"] as const;
export type TipoDeChat = (typeof TIPOS_DE_CHAT)[number];

export const MAXIMO_BIEN = 1;
export const MAXIMO_MEJORABLE = 2;
/** El WhatsApp de la asesora tiene que quedar por debajo de esto. */
export const LARGO_MAXIMO_ASESORA = 600;

export type ChatRevisado = {
  chatId: string;
  tipo: TipoDeChat;
  quePaso: string;
  momentoCaida: string;
  mensajeModelo: string;
  causa: CausaCoach;
};

export type DatosDeRevision = {
  nombre: string;
  modelo: string;
  resumen: string;
  chats: ChatRevisado[];
  chatsLeidos: number;
};

/** Lo mínimo de una revisión guardada para escribir los avisos. */
export type RevisionParaAviso = {
  userId: string;
  nombre: string;
  resumen: string;
  chats: ChatRevisado[];
  chatsLeidos?: number;
};

// 7 o más dígitos seguidos, con o sin espacios, guiones o un + delante: "3001234567",
// "+57 300 123 4567", "300-123-4567". Una fecha AAAA-MM-DD sola no cuenta como teléfono.
const TELEFONO = /\+?\d(?:[\s-]{0,2}\d){6,}/g;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function tieneTelefono(texto: string) {
  return [...texto.matchAll(TELEFONO)].some(([encontrado]) => !FECHA.test(encontrado));
}

/** Deja solo los últimos 4 dígitos de un teléfono ("+57 300 123 4567" -> "4567"). */
export function ultimos4(telefono: string | null | undefined) {
  return String(telefono ?? "").replace(/\D/g, "").slice(-4);
}

/** Cambia cualquier teléfono escrito en el texto por "…" y sus últimos 4 dígitos. */
export function taparTelefonos(texto: string) {
  return texto.replace(TELEFONO, (encontrado) => (FECHA.test(encontrado) ? encontrado : `…${ultimos4(encontrado)}`));
}

function esTexto(valor: unknown): valor is string {
  return typeof valor === "string";
}

/**
 * Devuelve los errores de una revisión (vacío = se puede guardar). Rechaza más de 1 chat 'bien',
 * más de 2 'mejorable', una causa fuera de CAUSAS y cualquier teléfono escrito en el texto.
 */
export function validarRevision(args: unknown): string[] {
  const errores: string[] = [];
  if (!args || typeof args !== "object") return ["La revisión viene vacía."];
  const datos = args as Record<string, unknown>;

  for (const campo of ["nombre", "modelo", "resumen"] as const) {
    const valor = datos[campo];
    if (!esTexto(valor) || !valor.trim()) errores.push(`Falta "${campo}".`);
    else if (tieneTelefono(valor)) errores.push(`"${campo}" trae un teléfono: déjalo solo con los últimos 4 dígitos.`);
  }

  const leidos = datos.chatsLeidos;
  if (typeof leidos !== "number" || !Number.isInteger(leidos) || leidos < 0) {
    errores.push(`"chatsLeidos" tiene que ser un número entero desde 0.`);
  }

  if (!Array.isArray(datos.chats)) {
    errores.push(`"chats" tiene que ser una lista.`);
    return errores;
  }

  let bien = 0;
  let mejorable = 0;
  const vistos = new Set<string>();
  datos.chats.forEach((crudo, indice) => {
    const n = `Chat ${indice + 1}`;
    if (!crudo || typeof crudo !== "object") {
      errores.push(`${n}: viene vacío.`);
      return;
    }
    const chat = crudo as Record<string, unknown>;
    if (!esTexto(chat.chatId) || !chat.chatId.trim()) errores.push(`${n}: falta "chatId".`);
    else if (vistos.has(chat.chatId)) errores.push(`${n}: el chat ${chat.chatId} está repetido.`);
    else vistos.add(chat.chatId);

    if (chat.tipo === "bien") bien += 1;
    else if (chat.tipo === "mejorable") mejorable += 1;
    else errores.push(`${n}: "tipo" tiene que ser bien o mejorable.`);

    if (!CAUSAS.includes(chat.causa as CausaCoach)) {
      errores.push(`${n}: la causa "${String(chat.causa)}" no existe (usa ${CAUSAS.join(", ")}).`);
    }

    for (const campo of ["quePaso", "momentoCaida", "mensajeModelo"] as const) {
      const valor = chat[campo];
      if (!esTexto(valor)) errores.push(`${n}: falta "${campo}".`);
      else if (tieneTelefono(valor)) errores.push(`${n}: "${campo}" trae un teléfono: déjalo solo con los últimos 4 dígitos.`);
    }
  });

  if (bien > MAXIMO_BIEN) errores.push(`Hay ${bien} chats "bien": el máximo es ${MAXIMO_BIEN}.`);
  if (mejorable > MAXIMO_MEJORABLE) errores.push(`Hay ${mejorable} chats "mejorable": el máximo es ${MAXIMO_MEJORABLE}.`);
  return errores;
}

/** Los chats que sí se le cuentan a la asesora: fuera los que se cayeron por el bot o la política. */
export function chatsParaLaAsesora(chats: ChatRevisado[]) {
  return chats.filter((chat) => chat.causa !== "bot" && chat.causa !== "politica");
}

function recortar(texto: string, maximo: number) {
  const limpio = taparTelefonos(texto).replace(/\s+/g, " ").trim();
  if (limpio.length <= maximo) return limpio;
  if (maximo <= 1) return "";
  return `${limpio.slice(0, maximo - 1).trimEnd()}…`;
}

export function linkDeLaAsesora(urlBase: string, userId: string) {
  return `${urlBase.replace(/\/+$/, "")}/cliente/equipo/coach/asesora/${encodeURIComponent(userId)}`;
}

/**
 * El WhatsApp corto para la asesora (menos de 600 caracteres): el resumen, lo que hizo bien, cuántos
 * chats tiene para mejorar y el link a su revisión. No nombra los chats de causa bot o política.
 */
export function textoParaAsesora(revision: RevisionParaAviso, urlBase: string) {
  const nombre = recortar(revision.nombre.split(/\s+/)[0] || revision.nombre, 30);
  const visibles = chatsParaLaAsesora(Array.isArray(revision.chats) ? revision.chats : []);
  const bien = visibles.find((chat) => chat.tipo === "bien");
  const mejorables = visibles.filter((chat) => chat.tipo === "mejorable").length;
  const link = linkDeLaAsesora(urlBase, revision.userId);

  const saludo = `Hola ${nombre} 👋 Tu revisión del Coach de hoy:`;
  const mejorar =
    mejorables > 0
      ? `💡 ${mejorables === 1 ? "1 chat" : `${mejorables} chats`} para mejorar, con el mensaje modelo.`
      : "";
  const cierre = `Míralo aquí: ${link}`;

  // Lo fijo va entero; el resumen y lo que hizo bien se recortan para que todo quepa.
  const fijo = [saludo, mejorar, cierre].filter(Boolean).join("\n").length;
  const libre = Math.max(0, LARGO_MAXIMO_ASESORA - 1 - fijo - 4);
  const paraBien = bien ? Math.min(160, Math.floor(libre / 3)) : 0;
  const lineaBien = bien && paraBien > 10 ? `✅ Bien: ${recortar(bien.quePaso, paraBien - 9)}` : "";
  const resumen = recortar(revision.resumen, libre - lineaBien.length);

  const texto = [saludo, resumen, lineaBien, mejorar, cierre].filter(Boolean).join("\n");
  return texto.length < LARGO_MAXIMO_ASESORA ? texto : [saludo, cierre].join("\n");
}

/** Una línea por asesora para el dueño (él sí ve los chats del bot y de la política). */
export function lineasParaDueno(revisiones: RevisionParaAviso[]) {
  const porAsesora = new Map<string, RevisionParaAviso>();
  for (const revision of revisiones) porAsesora.set(revision.userId, revision);
  return [...porAsesora.values()].map((revision) => {
    const chats = Array.isArray(revision.chats) ? revision.chats : [];
    const bien = chats.filter((chat) => chat.tipo === "bien").length;
    const mejorable = chats.filter((chat) => chat.tipo === "mejorable").length;
    const ajenos = chats.filter((chat) => chat.causa === "bot" || chat.causa === "politica").length;
    const partes = [
      typeof revision.chatsLeidos === "number" ? `${revision.chatsLeidos} chats leídos` : null,
      `${bien} bien`,
      `${mejorable} para mejorar`,
      ajenos > 0 ? `${ajenos} por el bot o la política` : null,
    ].filter(Boolean);
    return `${recortar(revision.nombre, 40)}: ${partes.join(" · ")} — ${recortar(revision.resumen, 140)}`;
  });
}
