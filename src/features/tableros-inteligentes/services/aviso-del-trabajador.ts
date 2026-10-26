import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";

import { ErrorDelTrabajador, type ContextoTrabajador } from "./trabajador";

/*
  AVISO DEL TRABAJADOR por WhatsApp (23-oct-2026): el trabajador del Tablero IA (PC aizen1) le avisa al
  dueño, por ejemplo, que el plan de Claude pasó el umbral de uso. Sale desde la línea Admin del negocio
  (la que se llama "Admin" o tiene purpose ADMIN; nunca una de ventas) al número guardado en la AppSetting
  `trabajador:aviso-telefono:<workspaceId>`. Sin número: 412. Como mucho 1 aviso por minuto por negocio y
  500 caracteres. El envío es el de siempre (`sendEvolutionTextMessageWithReconnect`, que también sabe
  WAHA): no se toca nada de la zona de chats. No se guarda en ningún chat (como los avisos de gravedad).

  25-oct-2026 (pedido del dueño: mensajes cortos): el servidor deja el aviso en 3 líneas como mucho y lo
  silencia de 9 p. m. a 7 a. m. (hora de Bogotá): en ese horario no se manda y se responde `silenciado`,
  para que el Coordinador lo reintente y salga a las 7 a. m. si sigue siendo cierto.
*/

export const claveTelefonoDeAviso = (workspaceId: string) => `trabajador:aviso-telefono:${workspaceId}`;

export const MAXIMO_TEXTO_DE_AVISO = 500;
export const MAXIMO_LINEAS_DE_AVISO = 3;
const HORA_DEL_SILENCIO = 21;
const HORA_DEL_FIN_DEL_SILENCIO = 7;
const UN_MINUTO = 60_000;

/** Último aviso por negocio (en memoria del proceso: el CRM corre en un solo contenedor). */
const ultimoAviso = new Map<string, number>();

/** El texto como lo manda el trabajador: no vacío, hasta 500 caracteres. */
export function textoDeAvisoDeEntrada(valor: unknown): string {
  const texto = typeof valor === "string" ? valor.replace(/\r\n/g, "\n").trim() : "";
  if (!texto) throw new ErrorDelTrabajador("Falta el texto del aviso.", 400);
  if (texto.length > MAXIMO_TEXTO_DE_AVISO) {
    throw new ErrorDelTrabajador(`El aviso tiene ${texto.length} caracteres: el máximo es ${MAXIMO_TEXTO_DE_AVISO}.`, 400);
  }
  return texto;
}

/** El aviso con 3 líneas como mucho (las líneas vacías no cuentan). */
export function recortarALineas(texto: string, maximo = MAXIMO_LINEAS_DE_AVISO): string {
  return texto
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean)
    .slice(0, maximo)
    .join("\n");
}

/** ¿Es el silencio de los avisos del tablero? De 9 p. m. a 7 a. m. en Bogotá (UTC-5, sin horario de verano). */
export function enSilencioDeAvisos(ahora: Date): boolean {
  const hora = new Date(ahora.getTime() - 5 * 3_600_000).getUTCHours();
  return hora >= HORA_DEL_SILENCIO || hora < HORA_DEL_FIN_DEL_SILENCIO;
}

/** El número guardado en la AppSetting, solo dígitos (10 o más), o null. */
export function telefonoDeAviso(valor: string | null | undefined): string | null {
  const numero = String(valor ?? "").replace(/\D/g, "");
  return numero.length >= 10 ? numero : null;
}

/** ¿Ya salió un aviso de este negocio en el último minuto? Si no, anota este. */
export function puedeAvisarAhora(workspaceId: string, ahora = Date.now()): boolean {
  const ultimo = ultimoAviso.get(workspaceId) ?? 0;
  if (ahora - ultimo < UN_MINUTO) return false;
  ultimoAviso.set(workspaceId, ahora);
  return true;
}

/** La línea Admin del negocio: la que se llama "Admin" primero, si no la de purpose ADMIN; conectada primero. */
async function lineaAdmin(workspaceId: string) {
  const lineas = await prisma.whatsAppChannel.findMany({
    where: {
      workspaceId,
      isActive: true,
      evolutionInstanceName: { not: null },
      OR: [{ name: { equals: "Admin", mode: "insensitive" } }, { purpose: "ADMIN" }],
    },
    select: { id: true, name: true, status: true, evolutionInstanceName: true },
  });
  const puntaje = (linea: (typeof lineas)[number]) =>
    (linea.name.trim().toLowerCase() === "admin" ? 2 : 0) + (linea.status === "CONNECTED" ? 1 : 0);
  return lineas.sort((a, b) => puntaje(b) - puntaje(a))[0] ?? null;
}

export async function enviarAvisoDelTrabajador(contexto: ContextoTrabajador, cuerpo: unknown, ahora = new Date()) {
  const texto = recortarALineas(textoDeAvisoDeEntrada((cuerpo as { texto?: unknown } | null)?.texto));
  if (enSilencioDeAvisos(ahora)) return { silenciado: true as const, motivo: "Silencio de 9 p. m. a 7 a. m.: el aviso no se mandó." };
  const fila = await prisma.appSetting.findUnique({ where: { key: claveTelefonoDeAviso(contexto.workspaceId) } });
  const numero = telefonoDeAviso(fila?.value);
  if (!numero) {
    throw new ErrorDelTrabajador(
      `No hay número para los avisos del Coordinador: guardarlo en la AppSetting "${claveTelefonoDeAviso(contexto.workspaceId)}" (solo dígitos, con indicativo, p. ej. 573001234567).`,
      412,
    );
  }
  const linea = await lineaAdmin(contexto.workspaceId);
  if (!linea?.evolutionInstanceName) {
    throw new ErrorDelTrabajador('El negocio no tiene una línea de WhatsApp "Admin" (o con purpose ADMIN) para mandar el aviso.', 412);
  }
  if (!puedeAvisarAhora(contexto.workspaceId)) {
    throw new ErrorDelTrabajador("Ya salió un aviso en el último minuto: se manda como mucho uno por minuto.", 429);
  }
  try {
    await sendEvolutionTextMessageWithReconnect({ instanceName: linea.evolutionInstanceName, phoneNumber: numero, text: texto });
  } catch (error) {
    // No salió: no cuenta para el límite de 1 por minuto.
    ultimoAviso.delete(contexto.workspaceId);
    console.warn("[trabajador-aviso] no salió el WhatsApp", {
      numero: `…${numero.slice(-4)}`,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new ErrorDelTrabajador("No se pudo mandar el WhatsApp por la línea Admin (¿está conectada?).", 502);
  }
  return { silenciado: false as const, linea: linea.name, numero: `…${numero.slice(-4)}` };
}
