import { leerEstado } from "@/features/agente-v3/motor/estado";
import {
  leerConfigDeAvisos,
  normalizarNumeroDeAviso,
  numeroDeAvisosDe,
} from "@/features/agente-v3/servicios/avisos";
import {
  TITULO_PARA_EL_LIDER,
  VIDA_DE_LA_MARCA_MS,
  armarTextoParaElLider,
  decidirMarca,
  mensajeDeCierre,
  type EstadoDeLaMarca,
} from "@/features/listo-para-pagar/dominio/senal";
import { enHorario } from "@/features/supervisor/dominio/detectores-atencion";
import { decidirViaDeAvisos } from "@/lib/anti-bloqueo/reglas";
import { leerConfigAntiBloqueo } from "@/lib/anti-bloqueo/servicio";
import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { resolverLiderDeVentas } from "@/lib/permisos-del-equipo";
import { prisma } from "@/lib/prisma";
import { ORIGENES_HUMANOS } from "@/lib/turno-de-la-conversacion";
import { sendPushToUser } from "@/lib/web-push";

/**
 * El mensaje de cierre con el 50 % del producto que el cliente está mirando (el `productoActivo`
 * del estado del V3). Si no hay producto o algo falla, sale el mensaje sin cifra. Nunca lanza.
 */
export async function leerMensajeDeCierre(workspaceId: string, conversationId: string): Promise<string> {
  try {
    const estado = await leerEstado(conversationId);
    if (!estado.productoActivo) {
      return mensajeDeCierre(null);
    }
    const producto = await prisma.product.findFirst({
      where: { id: estado.productoActivo, workspaceId },
      select: { price: true },
    });
    return mensajeDeCierre(producto ? Number(producto.price) : null);
  } catch {
    return mensajeDeCierre(null);
  }
}

/*
  LISTO PARA PAGAR (parte 3): la marca de cada aviso y el paso al líder de ventas.

  Cuando sale un aviso "Listo para pagar" queda una fila `listo-para-pagar:<chat>` en AppSetting.
  El reloj (cron/follows, cada minuto) la mira: si alguien del equipo escribió en el chat, queda
  "atendido"; si pasaron 5 minutos en horario de trabajo sin respuesta, el aviso le llega al líder
  de ventas ("escalado", una sola vez); a las 24 h se cierra sola. Al cliente no se le manda nada.
*/

const PREFIJO = "listo-para-pagar:";
/** Tope de avisos al líder por vuelta: al abrir el horario no sale una ráfaga. */
const MAXIMO_DE_ESCALADOS_POR_VUELTA = 5;

type Marca = {
  workspaceId: string;
  conversationId: string;
  asesoraId: string | null;
  avisadoEn: string;
  estado: EstadoDeLaMarca;
};

function leerMarca(valor: string | null | undefined): Marca | null {
  if (!valor) {
    return null;
  }
  try {
    const marca = JSON.parse(valor) as Partial<Marca>;
    if (
      typeof marca.workspaceId !== "string" ||
      typeof marca.conversationId !== "string" ||
      typeof marca.avisadoEn !== "string" ||
      typeof marca.estado !== "string"
    ) {
      return null;
    }
    return {
      workspaceId: marca.workspaceId,
      conversationId: marca.conversationId,
      asesoraId: typeof marca.asesoraId === "string" ? marca.asesoraId : null,
      avisadoEn: marca.avisadoEn,
      estado: marca.estado,
    };
  } catch {
    return null;
  }
}

/**
 * Deja la marca "pendiente" de un aviso "Listo para pagar". No pisa una marca "pendiente" ni una
 * "escalado" de menos de 24 h: una repetición no reinicia el reloj ni le vuelve a avisar al líder.
 */
export async function guardarMarcaListoParaPagar(input: {
  workspaceId: string;
  conversationId: string;
  asesoraId: string | null;
  ahora?: Date;
}): Promise<void> {
  const ahora = input.ahora ?? new Date();
  const key = `${PREFIJO}${input.conversationId}`;
  const previa = leerMarca((await prisma.appSetting.findUnique({ where: { key } }))?.value);
  if (previa && (previa.estado === "pendiente" || previa.estado === "escalado")) {
    const edad = ahora.getTime() - Date.parse(previa.avisadoEn);
    if (Number.isFinite(edad) && edad < VIDA_DE_LA_MARCA_MS) {
      return;
    }
  }
  const marca: Marca = {
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    asesoraId: input.asesoraId,
    avisadoEn: ahora.toISOString(),
    estado: "pendiente",
  };
  const value = JSON.stringify(marca);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/**
 * Cambia el estado de la marca solo si nadie la tocó desde que se leyó (compara el valor entero).
 * Así dos vueltas del reloj que se pisan no le avisan dos veces al líder. Devuelve si la cambió.
 */
async function cambiarEstado(key: string, valorLeido: string, marca: Marca, estado: EstadoDeLaMarca): Promise<boolean> {
  const { count } = await prisma.appSetting.updateMany({
    where: { key, value: valorLeido },
    data: { value: JSON.stringify({ ...marca, estado }) },
  });
  return count > 0;
}

/** ¿Alguien del equipo (desde el CRM o el teléfono) escribió en el chat después del aviso? */
async function huboRespuestaHumana(conversationId: string, desde: Date): Promise<boolean> {
  const mensaje = await prisma.message.findFirst({
    where: {
      conversationId,
      direction: "OUTBOUND",
      type: { not: "SYSTEM" },
      createdAt: { gt: desde },
      OR: ORIGENES_HUMANOS.map((origen) => ({ rawPayload: { path: ["source"], equals: origen } })),
    },
    select: { id: true },
  });
  return Boolean(mensaje);
}

/** Le pasa el aviso al líder: push siempre y, si hay número y línea interna, WhatsApp. Nunca lanza. */
async function avisarAlLider(marca: Marca, liderId: string): Promise<void> {
  const conversacion = await prisma.conversation
    .findUnique({
      where: { id: marca.conversationId },
      select: {
        numero: true,
        assignedToUserId: true,
        contact: { select: { name: true, phoneNumber: true } },
      },
    })
    .catch(() => null);
  const cliente = conversacion?.contact?.name?.trim() || conversacion?.contact?.phoneNumber || "Cliente";
  const asesoraId = marca.asesoraId ?? conversacion?.assignedToUserId ?? null;
  const asesora = asesoraId
    ? await prisma.user.findUnique({ where: { id: asesoraId }, select: { name: true, email: true } }).catch(() => null)
    : null;
  const nombreDeLaAsesora = asesora?.name?.trim() || asesora?.email || null;
  // Mismo enlace corto que el aviso a la asesora (ver avisos.ts).
  const enlace = conversacion?.numero
    ? `https://app.aizenbot.com/c/${conversacion.numero}`
    : `https://app.aizenbot.com/cliente/chats?chatKey=agent:${marca.conversationId}&assigned=all`;
  const cierre = await leerMensajeDeCierre(marca.workspaceId, marca.conversationId);

  await sendPushToUser({
    userId: liderId,
    payload: {
      title: TITULO_PARA_EL_LIDER,
      body: [`${cliente}: ${cierre}`, `Asignado a: ${nombreDeLaAsesora ?? "nadie todavía"}`].join("\n").slice(0, 300),
      tag: `listo-para-pagar:${marca.conversationId}`,
      url: `/cliente/chats?chatKey=agent:${marca.conversationId}&assigned=all`,
    },
  }).catch((error) => {
    console.warn("[listo-para-pagar] no se pudo mandar el push al lider", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  try {
    const [config, antiBloqueo] = await Promise.all([
      leerConfigDeAvisos(marca.workspaceId),
      leerConfigAntiBloqueo(marca.workspaceId),
    ]);
    // Con los avisos por push (anti-bloqueo) o apagados, solo sale el push de arriba.
    if (!config?.activo || antiBloqueo.avisos.via === "push") {
      return;
    }
    const numero = normalizarNumeroDeAviso(numeroDeAvisosDe(config, liderId));
    // Al líder siempre por una línea del equipo, nunca por la de ventas del chat.
    const via = decidirViaDeAvisos({
      avisos: { via: "linea_interna", canalInternoId: antiBloqueo.avisos.canalInternoId },
      canalDelChat: null,
      canalDeLaConfig: config.canalId || null,
    });
    if (!numero || via.tipo !== "whatsapp" || via.canales.length === 0) {
      return;
    }
    const linea = await prisma.whatsAppChannel.findFirst({
      where: { id: via.canales[0], workspaceId: marca.workspaceId },
      select: { evolutionInstanceName: true },
    });
    if (!linea?.evolutionInstanceName) {
      return;
    }
    await sendEvolutionTextMessageWithReconnect({
      instanceName: linea.evolutionInstanceName,
      phoneNumber: numero,
      text: armarTextoParaElLider({ cliente, asesora: nombreDeLaAsesora, enlace, cierre }),
    });
  } catch (error) {
    console.warn("[listo-para-pagar] no se pudo mandar el WhatsApp al lider", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * La vuelta del reloj: revisa las marcas pendientes. Máximo 5 avisos al líder por vuelta; el resto
 * queda para la siguiente.
 */
export async function revisarListoParaPagar(
  ahora: Date = new Date(),
): Promise<{ revisadas: number; escaladas: number; atendidas: number; cerradas: number }> {
  const filas = await prisma.appSetting.findMany({
    where: { key: { startsWith: PREFIJO }, value: { contains: '"estado":"pendiente"' } },
    select: { key: true, value: true },
  });
  const marcas = filas
    .map((fila) => ({ fila, marca: leerMarca(fila.value) }))
    .filter((item): item is { fila: { key: string; value: string }; marca: Marca } => item.marca !== null)
    // Las más viejas primero: con el tope por vuelta, no se queda atrás la que más espera.
    .sort((a, b) => Date.parse(a.marca.avisadoEn) - Date.parse(b.marca.avisadoEn));

  const resultado = { revisadas: 0, escaladas: 0, atendidas: 0, cerradas: 0 };
  const dentroDelHorario = enHorario(ahora);
  for (const { fila, marca } of marcas) {
    if (resultado.escaladas >= MAXIMO_DE_ESCALADOS_POR_VUELTA) {
      break;
    }
    try {
      resultado.revisadas += 1;
      const avisadoEn = new Date(marca.avisadoEn);
      const decision = decidirMarca({
        estado: marca.estado,
        avisadoEn,
        ahora,
        huboRespuestaHumana: Number.isFinite(avisadoEn.getTime())
          ? await huboRespuestaHumana(marca.conversationId, avisadoEn)
          : false,
        enHorario: dentroDelHorario,
      });
      if (decision === "atendido") {
        if (await cambiarEstado(fila.key, fila.value, marca, "atendido")) resultado.atendidas += 1;
        continue;
      }
      if (decision === "cerrar") {
        if (await cambiarEstado(fila.key, fila.value, marca, "cerrado")) resultado.cerradas += 1;
        continue;
      }
      if (decision !== "escalar") {
        continue;
      }
      const liderId = await resolverLiderDeVentas(marca.workspaceId);
      if (!liderId) {
        console.warn("[listo-para-pagar] no hay lider de ventas a quien avisar", {
          workspaceId: marca.workspaceId,
          conversationId: marca.conversationId,
        });
        await cambiarEstado(fila.key, fila.value, marca, "sin_destino");
        continue;
      }
      // Primero la marca, después el envío: así nunca se le avisa dos veces al líder.
      if (!(await cambiarEstado(fila.key, fila.value, marca, "escalado"))) {
        continue;
      }
      resultado.escaladas += 1;
      await avisarAlLider(marca, liderId);
    } catch (error) {
      console.warn("[listo-para-pagar] no se pudo revisar la marca", {
        key: fila.key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return resultado;
}
