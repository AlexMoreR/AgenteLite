import { Prisma } from "@prisma/client";

import { registrarEventos } from "@/features/embudo/servicios/eventos";
import { createFollow } from "@/features/seguimientos/services/follows";
import { SQL_CHAT_ABIERTO } from "@/lib/chat-resuelto-sql";
import { prisma } from "@/lib/prisma";

import type { ConfigSeguimientoInteligente } from "../dominio/config";
import { evaluarLead } from "../dominio/motor";
import { PREFIJO_FOLLOW_TRAS_ASESORA, decidirTrasAsesora } from "../dominio/tras-asesora";
import { leerFicha, leerNotasDelTurno } from "./ficha";

/**
 * AUTOMÁTICOS DESPUÉS DE LA ASESORA, en vivo (regla en dominio/tras-asesora.ts).
 *
 * Cada 5 minutos, con `trasAsesora.modo` en sombra o activo, mira los chats PAUSADOS de las líneas
 * del V3 donde lo último es nuestro. Cuando toca un toque (1 h / día siguiente):
 *  - activo: agenda un Follow "Tras asesora: 1 h" que sale ya, por el motor de seguimientos de
 *    siempre: horario, tope total, espaciado, convivencia (exterior), freno de dos seguidos; se
 *    cancela si el cliente escribe o si la asesora vuelve a escribir antes de que salga.
 *  - sombra: solo anota SEGUIMIENTO_TRAS_ASESORA ("habría salido").
 * Nunca toca `automationPaused`: la IA sigue sin contestarle al cliente. Nunca lanza.
 */

const ultimaVuelta = new Map<string, number>();
const POR_VUELTA = 60;
/** Chat + su último mensaje → hasta cuándo no se vuelve a mirar (si escribe alguien, cambia la clave). */
const enEspera = new Map<string, number>();

export async function barrerTrasAsesora(workspaceId: string, config: ConfigSeguimientoInteligente, ahora = new Date()): Promise<number> {
  const ta = config.trasAsesora;
  if (!ta || ta.modo === "apagado" || !ta.horas.length) return 0;
  if (ahora.getTime() - (ultimaVuelta.get(workspaceId) ?? 0) < 4.5 * 60_000) return 0;
  ultimaVuelta.set(workspaceId, ahora.getTime());
  let agendados = 0;
  try {
    // Tope diario del negocio (Bogotá): lo agendado (o anotado en sombra) hoy.
    const hoy = new Date(ahora.getTime() - 5 * 3_600_000);
    const inicioDelDia = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate(), 5, 0, 0));
    let deHoy = ta.maxPorDia > 0
      ? await prisma.embudoEvento.count({ where: { workspaceId, tipo: "SEGUIMIENTO_TRAS_ASESORA", createdAt: { gte: inicioDelDia }, datos: { path: ["modo"], equals: ta.modo } } })
      : 0;
    const horasMaximas = Math.max(...ta.horas) + ta.horasDeGracia + 1;
    const candidatos = await prisma.$queryRaw<Array<{ id: string; lastMessageAt: Date | null }>>(Prisma.sql`
      SELECT c."id", c."lastMessageAt"
        FROM "Conversation" c
        JOIN "Contact" ct ON ct."id" = c."contactId"
        JOIN "WhatsAppChannel" w ON w."id" = c."channelId"
       WHERE c."workspaceId" = ${workspaceId}
         AND c."automationPaused" = true
         AND c."seguimientosApagados" = false
         AND (w."metadata"->>'agenteV3') = 'true'
         AND ct."crmStage"::text NOT IN ('GANADO', 'PERDIDO')
         ${SQL_CHAT_ABIERTO}
         AND c."lastMessageAt" >= ${new Date(ahora.getTime() - horasMaximas * 3_600_000)}
         AND c."lastMessageAt" <= ${new Date(ahora.getTime() - Math.min(...ta.horas) * 3_600_000 + 60_000)}
         AND (SELECT m."direction" FROM "Message" m
               WHERE m."conversationId" = c."id" AND m."type" <> 'SYSTEM' AND m."deletedAt" IS NULL
               ORDER BY m."createdAt" DESC LIMIT 1) = 'OUTBOUND'
       ORDER BY c."lastMessageAt" DESC
       LIMIT 400`);
    let mirados = 0;
    for (const { id, lastMessageAt } of candidatos) {
      if (mirados >= POR_VUELTA) break;
      const claveDeEspera = `${id}:${lastMessageAt?.toISOString() ?? ""}`;
      if ((enEspera.get(claveDeEspera) ?? 0) > ahora.getTime()) continue;
      mirados += 1;
      const ctx = await leerFicha(id).catch(() => null);
      if (!ctx) continue;
      ctx.ficha.notas = await leerNotasDelTurno(id).catch(() => []);
      // La calificación (no le interesa, caliente) y si está dormido por fecha: sin efectos.
      const { calificacion, decision } = evaluarLead(ctx.ficha, config, ahora);
      const resultado = decidirTrasAsesora({
        mensajes: ctx.ficha.mensajes,
        notas: ctx.ficha.notas,
        inicio: ctx.ficha.inicioDeLaCharla,
        nombre: ctx.ficha.nombre,
        pausado: ctx.ficha.pausado,
        pausadoEn: ctx.ficha.pausadoEn ?? null,
        etapaCrm: ctx.ficha.etapaCrm,
        noInteresa: calificacion.noInteresa && calificacion.temperatura === "FRIO",
        dormido: decision.accion === "dormido",
        pospuesto: Boolean(ctx.ficha.pospuesto),
        caliente: calificacion.temperaturaBase === "CALIENTE" || ctx.ficha.etapaCrm === "NEGOCIACION",
        config: ta,
        horario: { desde: config.formulario.desdeHora, hasta: config.formulario.hastaHora, dias: config.formulario.dias },
        ahora,
      });
      if (!resultado.sale) {
        // Lo que todavía no vence se mira a su hora; lo demás, en 1 h (o antes si alguien escribe).
        enEspera.set(claveDeEspera, resultado.revisarEn ? resultado.revisarEn.getTime() : ahora.getTime() + 3_600_000);
        continue;
      }
      // Uno por toque y por silencio: si ya se agendó (salga o lo frene el anti-bloqueo), no se repite.
      const yaEsta = await prisma.follow.count({
        where: {
          workspaceId,
          contactId: ctx.contactId,
          name: { startsWith: PREFIJO_FOLLOW_TRAS_ASESORA },
          OR: [{ status: "PENDING" }, { name: resultado.nombreDelFollow, createdAt: { gt: resultado.ultimoHumanoEn } }],
        },
      });
      if (yaEsta > 0) continue;
      if (ta.maxPorDia > 0 && deHoy >= ta.maxPorDia) {
        console.log("[seguimiento-inteligente] tope diario de automaticos tras la asesora", { workspaceId, maximo: ta.maxPorDia });
        break;
      }
      deHoy += 1;
      const clave = `TRAS:${ta.modo}:${id}:${resultado.ultimoHumanoEn.toISOString().slice(0, 16)}:${resultado.horas}`;
      if (ta.modo === "activo") {
        await createFollow({
          workspaceId,
          contactId: ctx.contactId,
          channelId: ctx.channelId,
          name: resultado.nombreDelFollow,
          timeType: "MINUTES",
          timeValue: 0,
          executeAt: ahora,
          messageType: "TEXT",
          content: resultado.texto,
          cancelOnActivity: true,
        });
        agendados += 1;
      }
      await registrarEventos({ workspaceId, conversationId: id, contactId: ctx.contactId, channelId: ctx.channelId }, [
        {
          tipo: "SEGUIMIENTO_TRAS_ASESORA",
          origen: "reloj",
          claveUnica: clave,
          createdAt: ahora,
          datos: { modo: ta.modo, horas: resultado.horas, toque: resultado.toque, ultimoHumanoEn: resultado.ultimoHumanoEn.toISOString(), texto: resultado.texto },
        },
      ]);
    }
    if (enEspera.size > 20_000) {
      for (const [clave, hasta] of enEspera) if (hasta < ahora.getTime()) enEspera.delete(clave);
    }
    if (agendados) console.log("[seguimiento-inteligente] automaticos tras la asesora", { workspaceId, agendados });
  } catch (error) {
    console.warn("[seguimiento-inteligente] fallo el barrido tras la asesora", { workspaceId, error: error instanceof Error ? error.message : String(error) });
  }
  return agendados;
}
