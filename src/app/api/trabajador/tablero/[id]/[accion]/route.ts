import { NextResponse } from "next/server";

import { ACCIONES_DEL_TRABAJADOR, type AccionDelTrabajador } from "@/features/tableros-inteligentes/services/reglas-trabajador";
import { accionDelTrabajador } from "@/features/tableros-inteligentes/services/trabajador";
import { SIN_CACHE, contextoDelPedido, respuestaDeError, sinClave } from "../../autenticar";

export const dynamic = "force-dynamic";

/*
  POST /api/trabajador/tablero/<tarjetaId>/<accion> — lo que el trabajador avisa de una tarjeta que tomó:
  - latido    { lugar?, sesion? }                 corre el vencimiento del candado (hasta el tope). Construyendo,
              lugar = "aizen1" | "nube" (en la nube el tope es de 180 min, no 90) y sesion = el link
              https://claude.ai/code/session_… (cualquier otro link se descarta); queda en resultado.construccion.
  - plan      { plan }                            PLANEANDO -> PLAN_LISTO.
  - resultado { resumen, pruebas, paso, rama, linkRama, commit, migracion, subeSolo, base, zonaProtegida?,
                construidoEn?, linkSesion?, segundosNube?, linkWorkflow?, verificadoEn? }   (construidoEn = "aizen1" | "nube")
                EN_CURSO -> SUBIENDO pendiente (paso, subeSolo y sin zona protegida) o POR_REVISAR.
  - subida    { commit, version, linkCommit }     SUBIENDO -> HECHO.
  - error     { motivo, categoria?, causa?, resumen?, error?, etapa?, zonaProtegida?, reversion? }
              PLANEANDO | EN_CURSO | SUBIENDO -> ERROR. reversion = { commit, revert, ok }: el despliegue
              falló después de subir y se hizo revert. Con `categoria`, `motivo` es el resumen de máximo
              3 líneas para el dueño y queda un intento "escalar".
  - soltar    { motivo, categoria?, causa?, error?, etapa? }   PLANEANDO -> APROBADO, EN_CURSO ->
              PLAN_APROBADO, SUBIENDO -> SUBIENDO pendiente, sin ERROR ni contar el intento (Claude llegó
              a su límite de uso, o choca con otra que corre). Con `categoria` queda un intento "esperar".
  - reparar   { etapa, categoria, causa, error, estrategia? }   PLANEANDO | EN_CURSO | SUBIENDO -> la fila sin
              ERROR (APROBADO / PLAN_APROBADO), reparaciones + 1. 409 si ya lleva 3.
  - partir    { causa, error, partes: [{ titulo, detalle }] }   EN_CURSO | PLANEANDO: crea de 2 a 4 hijas en orden
              (dependencia), la madre queda donde estaba, sin candado. Desde EN_CURSO las hijas quedan
              PLAN_APROBADO con su parte como plan; desde PLANEANDO (medir antes de planear) quedan APROBADO,
              sin plan. 409 si ya está partida o es una parte.
  - depender  { referencias: [id o título] }      APROBADO | PLANEANDO: pone la flecha de dependencia hacia esas
              tarjetas (mismo tablero, sin ciclos). Si alguna no está HECHO, PLANEANDO vuelve a APROBADO sin ERROR
              ni contar el intento: queda "Esperando a «X»". -> { creadas, esperando, soltada }
  - recoger   { decision: reintentar | partir | dueno, causa?, error?, partes?, linea? }   ERROR: recoge una tarjeta
              vieja en ERROR (máximo 2 veces por tarjeta; el tope diario lo lleva el Coordinador). reintentar vuelve
              a la fila, partir crea las hijas, dueno deja UNA línea para el dueño y sigue en ERROR.
  - revisado  { confirmaciones: [línea] }         POR_REVISAR -> SUBIENDO: el Coordinador comprobó con el diff real la prueba extra
              de chats o del bot (sin envíos nuevos a clientes). 409 si la tarjeta esperaba por otra cosa.
  (El arranque del Coordinador es otra ruta: /api/trabajador/tablero/arranque.)
  409 si la tarjeta no está en el estado de esa acción. Ver services/trabajador.ts.
*/
export async function POST(request: Request, { params }: { params: Promise<{ id: string; accion: string }> }) {
  const contexto = await contextoDelPedido(request);
  if (!contexto) return sinClave();
  const { id, accion } = await params;
  if (!(ACCIONES_DEL_TRABAJADOR as readonly string[]).includes(accion)) {
    return NextResponse.json({ ok: false, error: "Esa acción no existe." }, { status: 404, headers: SIN_CACHE });
  }
  let cuerpo: Record<string, unknown> = {};
  try {
    const leido = await request.json();
    if (leido && typeof leido === "object" && !Array.isArray(leido)) cuerpo = leido as Record<string, unknown>;
  } catch {
    // Sin cuerpo (el latido no lo necesita).
  }
  try {
    const respuesta = await accionDelTrabajador(contexto, id, accion as AccionDelTrabajador, cuerpo);
    return NextResponse.json(respuesta, { headers: SIN_CACHE });
  } catch (fallo) {
    return respuestaDeError(fallo);
  }
}
