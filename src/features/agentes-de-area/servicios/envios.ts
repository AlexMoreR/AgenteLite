import { leerConfigGravedad, lineaInterna } from "@/features/avisos-gravedad/servicios/enrutador";
import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";

import {
  MOTIVO_SIN_LINEA,
  MOTIVO_YA_ENVIADO,
  claveDelDia,
  decidirEnvio,
  fechaBogota,
  numerosDelEquipo,
  soloDigitos,
  tipoDeDestino,
  type DestinoDelEquipo,
  type TipoDeEnvio,
} from "../dominio/reglas";
import { agenteActivo } from "./config";

/**
 * EL ÚNICO CAMINO por el que un agente de área manda un WhatsApp. Las reglas las pone el SERVIDOR; lo que
 * diga el agente no las cambia:
 *  - solo a números de la lista del equipo ("Mi empresa → Equipo", la misma de los avisos del Supervisor):
 *    un cliente nunca es de esa lista, así que nunca recibe nada;
 *  - solo por la línea INTERNA (Admin) que ya usa el Supervisor (`lineaInterna`), nunca una de ventas;
 *  - solo con el interruptor prendido;
 *  - un solo mensaje por número y por día (clave única en la base).
 * Cada intento queda anotado en AgenteDeAreaEnvio: a quién, qué texto y si salió o por qué no.
 */

/** Un envío "en camino" que lleva más de esto se da por muerto (se cayó el proceso) y se puede reintentar. */
const MINUTOS_PARA_DAR_POR_MUERTO = 10;

export type ResultadoDeEnvio = {
  enviado: boolean;
  estado: "ENVIADO" | "BLOQUEADO" | "FALLO" | "YA_ENVIADO";
  motivo: string | null;
  numero: string;
  tipo: TipoDeEnvio | null;
};

/** La lista de avisos del equipo (misma clave que lee el Supervisor). */
export async function leerDestinosDelEquipo(workspaceId: string): Promise<{ canalId?: string; destinos: DestinoDelEquipo[] }> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `agente-v3:avisos:${workspaceId}` } }).catch(() => null);
  try {
    const leido = fila?.value ? (JSON.parse(fila.value) as { canalId?: string; destinos?: DestinoDelEquipo[] }) : {};
    return { canalId: leido.canalId, destinos: Array.isArray(leido.destinos) ? leido.destinos : [] };
  } catch {
    return { destinos: [] };
  }
}

const esDuplicado = (error: unknown) => (error as { code?: string } | null)?.code === "P2002";

export async function mandarAlEquipo(input: {
  workspaceId: string;
  area: string;
  numero: unknown;
  texto: unknown;
  nombre?: string | null;
  ahora?: Date;
}): Promise<ResultadoDeEnvio> {
  const ahora = input.ahora ?? new Date();
  const fecha = fechaBogota(ahora);
  const avisos = await leerDestinosDelEquipo(input.workspaceId);
  const decision = decidirEnvio({
    numero: input.numero,
    texto: input.texto,
    activo: await agenteActivo(input.workspaceId, input.area),
    equipo: numerosDelEquipo(avisos.destinos),
  });
  const numero = decision.numero || soloDigitos(input.numero);
  const texto = typeof input.texto === "string" ? input.texto.trim() : "";
  const nombre = input.nombre?.trim().slice(0, 120) || null;
  const base = { workspaceId: input.workspaceId, area: input.area, fecha, numero, nombre, texto: texto.slice(0, 4000) };

  const bloquear = async (motivo: string, tipo: TipoDeEnvio | null): Promise<ResultadoDeEnvio> => {
    await prisma.agenteDeAreaEnvio
      .create({ data: { ...base, tipo: tipo ?? "ASESORA", estado: "BLOQUEADO", motivo } })
      .catch(() => {});
    return { enviado: false, estado: "BLOQUEADO", motivo, numero, tipo };
  };

  if (!decision.permitido) return bloquear(decision.motivo, null);

  const tipo = tipoDeDestino(numero, avisos.destinos);
  const linea = await lineaInterna(input.workspaceId, await leerConfigGravedad(input.workspaceId), avisos).catch(() => null);
  if (!linea) return bloquear(MOTIVO_SIN_LINEA, tipo);

  // Se reserva el día ANTES de mandar: si el PC reintenta, la clave única lo frena.
  const clave = claveDelDia(input.workspaceId, input.area, fecha, numero);
  let id: string;
  try {
    id = (await prisma.agenteDeAreaEnvio.create({ data: { ...base, tipo, estado: "ENVIANDO", claveDelDia: clave } })).id;
  } catch (error) {
    if (!esDuplicado(error)) throw error;
    const previo = await prisma.agenteDeAreaEnvio.findUnique({ where: { claveDelDia: clave } });
    const muerto =
      previo?.estado === "ENVIANDO" && ahora.getTime() - previo.updatedAt.getTime() > MINUTOS_PARA_DAR_POR_MUERTO * 60_000;
    if (!previo || !muerto) return { enviado: false, estado: "YA_ENVIADO", motivo: MOTIVO_YA_ENVIADO, numero, tipo };
    id = previo.id;
    await prisma.agenteDeAreaEnvio.update({ where: { id }, data: { texto: base.texto, estado: "ENVIANDO", motivo: null } });
  }

  try {
    await sendEvolutionTextMessageWithReconnect({ instanceName: linea.instancia, phoneNumber: numero, text: texto });
    await prisma.agenteDeAreaEnvio.update({ where: { id }, data: { estado: "ENVIADO", motivo: null } });
    return { enviado: true, estado: "ENVIADO", motivo: null, numero, tipo };
  } catch (error) {
    const motivo = `no salió por la línea Admin: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300);
    // Se libera la clave del día para que un reintento pueda salir (sin duplicar: este no salió).
    await prisma.agenteDeAreaEnvio.update({ where: { id }, data: { estado: "FALLO", motivo, claveDelDia: null } }).catch(() => {});
    return { enviado: false, estado: "FALLO", motivo, numero, tipo };
  }
}

/** Quién del equipo no tiene número de avisos (para la pantalla: "sin número de avisos"). */
export async function asesorasSinNumero(workspaceId: string): Promise<string[]> {
  const avisos = await leerDestinosDelEquipo(workspaceId);
  const conNumero = new Set(avisos.destinos.filter((d) => soloDigitos(d.numero).length >= 10).map((d) => d.userId ?? d.soloDe).filter(Boolean));
  const miembros = await prisma.workspaceMember
    .findMany({
      where: { workspaceId, isActive: true, role: { notIn: ["OWNER", "ADMIN"] } },
      select: { userId: true, user: { select: { name: true, email: true } } },
    })
    .catch(() => []);
  return miembros.filter((m) => !conNumero.has(m.userId)).map((m) => m.user?.name?.trim() || m.user?.email || m.userId);
}
