import { createHash } from "node:crypto";

import { ORIGEN_COORDINADOR } from "@/features/alertas/dominio/reglas";
import { registrarAlerta } from "@/features/alertas/servicios/alertas";
import { prisma } from "@/lib/prisma";

import { avisosPrendidos, enSilencioDeAvisos, enviarAlDueno } from "./avisos-al-dueno";
import { codigoDeTarjeta } from "./reglas";
import { tituloCorto } from "./resumen-corto";
import { linkDeHoy, linkDeLaTarjeta, todoElNegocio } from "./tableros";

/*
  AVISO "TERMINADA" AL DUEÑO por WhatsApp (30-oct-2026). Esto es una EXCEPCIÓN a dos decisiones anteriores: el 26-oct se
  decidió no avisar "terminó" y el 29-oct que por WhatsApp salgan solo los urgentes (ver avisos-al-dueno.ts). Aquí sí sale
  por WhatsApp aunque no sea urgente, pero SOLO cuando el Coordinador dejó una tarea en HECHO, y con su propio interruptor.

  Reglas:
  - Cuenta una tarjeta con repositorio que está en HECHO hace menos de 24 horas y que la puso en HECHO el Coordinador
    (subida SUBIENDO→HECHO, "ya-hecha" o el cierre de una madre partida: todos dejan en el historial origen TRABAJADOR).
    El HECHO a mano (pantalla o MCP) no cuenta.
  - Interruptores: el general de los avisos al dueño (`tablero:avisos-dueno:activo:<ws>`) y el propio
    `tablero:avisos-dueno:terminadas:<ws>` ("false" = apagado; EMPIEZA PRENDIDO). Con cualquiera apagado no sale nada.
  - La primera vez (bandera `tablero:avisos-dueno:terminadas-base:<ws>`) todo lo que ya estaba HECHO se anota YA_VISTO
    sin mandarlo. Al apagar un interruptor la bandera se borra: al volver a prenderlo no sale una ola de mensajes.
  - Un aviso por tarjeta: la fila de AvisoTarjetaEquipo con motivo "terminada" (índice único tarjetaId+motivo). Lo que
    quedó pendiente en la vuelta sale junto en UN solo mensaje. AvisoTarjetaEquipo con motivo "terminada" NO es un aviso
    al equipo: avisos-al-equipo.ts lo ignora.
  - Silencio de 9 p. m. a 7 a. m. (Bogotá): no manda nada y lo deja para la vuelta de las 7 a. m.
  - Sale con enviarAlDueno: solo por la línea Admin y solo al número del dueño de Mi empresa → Claude.
  - Queda también en la campanita (/cliente/alertas) con prioridad BAJA.
  - Si falla, suma intentos; después del 3.º queda FALLIDO.
  El reloj del servidor llama a revisarAvisosDeTerminadas (lo conecta otra parte).
*/

export const MOTIVO_TERMINADA = "terminada";
export const claveInterruptorDeTerminadas = (workspaceId: string) => `tablero:avisos-dueno:terminadas:${workspaceId}`;
const claveBase = (workspaceId: string) => `tablero:avisos-dueno:terminadas-base:${workspaceId}`;

const MS_HORA = 3_600_000;
const HORAS_VIGENTE = 24;
const MAXIMO_INTENTOS = 3;
/** Tope de tarjetas por mensaje: si hay más, el resto sale en la vuelta siguiente. */
const MAXIMO_POR_MENSAJE = 20;
const MAXIMO_NOMBRADAS = 2;
const ORIGEN_DEL_COORDINADOR = "TRABAJADOR";

/* ───────────────────────────────────────────────────────────────────── las reglas (puras) ── */

export type TarjetaTerminada = { id: string; numero: number | null; titulo: string; repo: string | null; estado: string };
/** Una fila del historial de la tarjeta (HistorialTarjeta). */
export type CambioDeTarjeta = { origen: string; accion: string; despues: unknown; creadoEn: Date; deshechoEn?: Date | null };

const estadoDeLaFila = (despues: unknown): string | null =>
  despues && typeof despues === "object" && typeof (despues as { estado?: unknown }).estado === "string" ? (despues as { estado: string }).estado : null;

/**
 * ¿La puso en HECHO el Coordinador hace menos de 24 horas? Se mira el ÚLTIMO cambio del historial que dejó la tarjeta en
 * HECHO: si fue del trabajador (origen TRABAJADOR) cuenta; si fue a mano (PANTALLA o MCP) no. Sin repo no cuenta.
 */
export function esTerminadaDelCoordinador(tarjeta: Pick<TarjetaTerminada, "repo" | "estado">, cambios: readonly CambioDeTarjeta[], ahora: Date = new Date()): boolean {
  if (!tarjeta.repo || tarjeta.estado !== "HECHO") return false;
  let ultimo: CambioDeTarjeta | null = null;
  for (const cambio of cambios) {
    if (cambio.accion !== "estado" || cambio.deshechoEn || estadoDeLaFila(cambio.despues) !== "HECHO") continue;
    if (!ultimo || cambio.creadoEn.getTime() > ultimo.creadoEn.getTime()) ultimo = cambio;
  }
  if (!ultimo || ultimo.origen !== ORIGEN_DEL_COORDINADOR) return false;
  return ahora.getTime() - ultimo.creadoEn.getTime() < HORAS_VIGENTE * MS_HORA;
}

const nombreDeLaTarjeta = (tarjeta: Pick<TarjetaTerminada, "numero" | "titulo">) =>
  [codigoDeTarjeta(tarjeta.numero), tituloCorto(tarjeta.titulo)].filter(Boolean).join(" ");

/** El mensaje: una tarjeta con su link; varias con el link de hoy (`link` ya viene elegido por quien llama). */
export function textoDeTerminadas(tarjetas: readonly Pick<TarjetaTerminada, "numero" | "titulo">[], link: string): string {
  if (tarjetas.length === 1) {
    const codigo = codigoDeTarjeta(tarjetas[0].numero);
    return `✅ ¡Listo! Terminó la tarea ${codigo ? `${codigo}: ` : ""}${tituloCorto(tarjetas[0].titulo)} 🚀\n${link}`;
  }
  const nombradas = tarjetas.slice(0, MAXIMO_NOMBRADAS).map(nombreDeLaTarjeta);
  const resto = tarjetas.length - nombradas.length;
  const lista = resto > 0 ? `${nombradas.join(", ")} y ${resto} más` : nombradas.join(" y ");
  return `✅ ¡Listo! Terminaron ${tarjetas.length} tareas: ${lista} 🚀\n${link}`;
}

/* ───────────────────────────────────────────────────────────────────── la revisión ── */

export async function terminadasPrendido(workspaceId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveInterruptorDeTerminadas(workspaceId) }, select: { value: true } });
  return fila?.value !== "false";
}

const esChoqueDeUnico = (error: unknown) => (error as { code?: string } | null)?.code === "P2002";

async function guardarBase(workspaceId: string, ahora: Date) {
  const key = claveBase(workspaceId);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: ahora.toISOString() }, update: { value: ahora.toISOString() } });
}

/** La primera vuelta: lo que ya estaba HECHO se anota YA_VISTO, sin mandarlo. */
async function anotarLoQueYaEstabaHecho(workspaceId: string, ahora: Date) {
  const hechas = await prisma.tarjetaTablero.findMany({
    where: { estado: "HECHO", borradoEn: null, tablero: { workspaceId: todoElNegocio(workspaceId).workspaceId } },
    select: { id: true },
  });
  if (hechas.length) {
    await prisma.avisoTarjetaEquipo.createMany({
      data: hechas.map((tarjeta) => ({ workspaceId, tarjetaId: tarjeta.id, motivo: MOTIVO_TERMINADA, estado: "YA_VISTO", detalle: "ya estaba terminada antes de prender este aviso" })),
      skipDuplicates: true,
    });
  }
  await guardarBase(workspaceId, ahora);
}

/** La revisión de un negocio. Devuelve lo que mandó (0 o 1 mensajes). */
export async function revisarAvisosDeTerminadasDelNegocio(workspaceId: string, ahora: Date): Promise<{ enviados: number }> {
  if (!(await avisosPrendidos(workspaceId)) || !(await terminadasPrendido(workspaceId))) {
    // Apagado: al volver a prenderlo se anota de nuevo lo que haya, sin avisar.
    await prisma.appSetting.deleteMany({ where: { key: claveBase(workspaceId) } });
    return { enviados: 0 };
  }
  const hayBase = await prisma.appSetting.findUnique({ where: { key: claveBase(workspaceId) }, select: { value: true } });
  if (!hayBase) {
    await anotarLoQueYaEstabaHecho(workspaceId, ahora);
    return { enviados: 0 };
  }
  // De 9 p. m. a 7 a. m. no sale nada, ni se anota: queda para la vuelta de las 7 a. m.
  if (enSilencioDeAvisos(ahora)) return { enviados: 0 };

  const desde = new Date(ahora.getTime() - HORAS_VIGENTE * MS_HORA);
  const hechas = await prisma.tarjetaTablero.findMany({
    where: { estado: "HECHO", borradoEn: null, repo: { not: null }, actualizadoEn: { gte: desde }, tablero: { workspaceId: todoElNegocio(workspaceId).workspaceId } },
    select: { id: true, numero: true, titulo: true, repo: true, estado: true },
    orderBy: { numero: "asc" },
  });
  if (!hechas.length) return { enviados: 0 };
  const ids = hechas.map((tarjeta) => tarjeta.id);

  const [filasDelHistorial, existentes] = await Promise.all([
    prisma.historialTarjeta.findMany({ where: { tarjetaId: { in: ids }, accion: "estado" }, select: { tarjetaId: true, origen: true, accion: true, despues: true, creadoEn: true, deshechoEn: true } }),
    prisma.avisoTarjetaEquipo.findMany({ where: { workspaceId, motivo: MOTIVO_TERMINADA, tarjetaId: { in: ids } }, select: { id: true, tarjetaId: true, estado: true, intentos: true } }),
  ]);
  const cambiosPor = new Map<string, CambioDeTarjeta[]>();
  for (const fila of filasDelHistorial) cambiosPor.set(fila.tarjetaId, [...(cambiosPor.get(fila.tarjetaId) ?? []), fila]);
  const filas = new Map(existentes.map((fila) => [fila.tarjetaId, fila]));

  // Se reserva cada aviso ANTES de mandarlo: crear la fila (o subir sus intentos) solo le sale bien a una vuelta.
  const porAvisar: { tarjeta: (typeof hechas)[number]; id: string; intentos: number }[] = [];
  for (const tarjeta of hechas) {
    if (porAvisar.length >= MAXIMO_POR_MENSAJE) break;
    if (!esTerminadaDelCoordinador(tarjeta, cambiosPor.get(tarjeta.id) ?? [], ahora)) continue;
    const existente = filas.get(tarjeta.id);
    if (existente && existente.estado !== "PENDIENTE") continue;
    if (existente) {
      if (existente.intentos >= MAXIMO_INTENTOS) {
        await prisma.avisoTarjetaEquipo.updateMany({ where: { id: existente.id, estado: "PENDIENTE" }, data: { estado: "FALLIDO" } });
        continue;
      }
      const tomado = await prisma.avisoTarjetaEquipo.updateMany({
        where: { id: existente.id, estado: "PENDIENTE", intentos: existente.intentos },
        data: { intentos: existente.intentos + 1 },
      });
      if (tomado.count) porAvisar.push({ tarjeta, id: existente.id, intentos: existente.intentos + 1 });
      continue;
    }
    try {
      const creada = await prisma.avisoTarjetaEquipo.create({
        data: { workspaceId, tarjetaId: tarjeta.id, motivo: MOTIVO_TERMINADA, estado: "PENDIENTE", intentos: 1 },
        select: { id: true },
      });
      porAvisar.push({ tarjeta, id: creada.id, intentos: 1 });
    } catch (error) {
      if (!esChoqueDeUnico(error)) throw error;
    }
  }
  if (!porAvisar.length) return { enviados: 0 };

  const tarjetas = porAvisar.map((aviso) => aviso.tarjeta);
  const texto = textoDeTerminadas(tarjetas, tarjetas.length === 1 ? linkDeLaTarjeta(tarjetas[0].id) : linkDeHoy());
  const envio = await enviarAlDueno(workspaceId, texto);

  let quedoFallido = false;
  for (const aviso of porAvisar) {
    if (envio.salio) {
      await prisma.avisoTarjetaEquipo.updateMany({ where: { id: aviso.id }, data: { estado: "ENVIADO", enviadoEn: new Date(), detalle: null } });
    } else {
      const ultimo = aviso.intentos >= MAXIMO_INTENTOS;
      quedoFallido = quedoFallido || ultimo;
      await prisma.avisoTarjetaEquipo.updateMany({
        where: { id: aviso.id },
        data: { estado: ultimo ? "FALLIDO" : "PENDIENTE", detalle: `no salió (intento ${aviso.intentos}): ${envio.motivo}` },
      });
    }
  }

  // La campanita (/cliente/alertas), prioridad BAJA: una por mensaje, cuando ya salió o ya no se va a reintentar.
  if (envio.salio || quedoFallido) {
    const huella = createHash("sha1").update(tarjetas.map((tarjeta) => tarjeta.id).sort().join("|")).digest("hex").slice(0, 16);
    await registrarAlerta({
      workspaceId,
      clave: `terminadas:${huella}`,
      prioridad: "BAJA",
      titulo: texto.split("\n")[0],
      detalle: tarjetas.map(nombreDeLaTarjeta).join("\n"),
      origen: ORIGEN_COORDINADOR,
      refrescar: false,
    });
  }
  return { enviados: envio.salio ? 1 : 0 };
}

/** La vuelta del reloj: revisa cada negocio con tableros. Nunca lanza por un negocio. */
export async function revisarAvisosDeTerminadas(ahora: Date = new Date()): Promise<{ enviados: number }> {
  const negocios = await prisma.tableroInteligente.findMany({ distinct: ["workspaceId"], select: { workspaceId: true } });
  let enviados = 0;
  for (const { workspaceId } of negocios) {
    try {
      enviados += (await revisarAvisosDeTerminadasDelNegocio(workspaceId, ahora)).enviados;
    } catch (error) {
      console.error("[avisos-de-terminadas] no se pudo revisar el negocio", { workspaceId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { enviados };
}
