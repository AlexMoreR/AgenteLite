import { redirect } from "next/navigation";

import { PanelAgenteDeArea, type DatosDelPanel } from "./PanelAgenteDeArea";
import { ETIQUETA_DE_AREA, fechaValida, hoyEnBogota, type Area } from "@/features/agentes-de-area/dominio/reglas";
import { numerosDeRespuestaBienvenida } from "@/features/agentes-de-area/servicios/numeros-respuesta-bienvenida";
import { agenteActivo, leerEquipoDeAvisos } from "@/features/agentes-de-area/servicios/config";
import { leerEnviosDelDia, leerResumenDelDia, leerUltimosResumenes } from "@/features/agentes-de-area/servicios/resumenes";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";
import { prisma } from "@/lib/prisma";

/** Marketing guarda su línea para Alexander y su recomendación dentro de `meta`. */
function lineaYRecomendacion(meta: unknown): { linea: string | null; recomendacion: { accion: string; texto: string; dato: string } | null } {
  const datos = meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
  const rec = datos.recomendacion && typeof datos.recomendacion === "object" ? (datos.recomendacion as Record<string, unknown>) : null;
  return {
    linea: typeof datos.linea === "string" ? datos.linea : null,
    recomendacion: rec ? { accion: String(rec.accion ?? ""), texto: String(rec.texto ?? ""), dato: String(rec.dato ?? "") } : null,
  };
}

/** Sistemas guarda su línea y sus tarjetas de arreglo dentro de `meta`. */
function lineaYArreglos(meta: unknown): { linea: string | null; arreglos: Array<{ titulo: string; estado: string }> } {
  const datos = meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
  const arreglos = Array.isArray(datos.arreglos)
    ? datos.arreglos.flatMap((a) => (a && typeof a === "object" && typeof (a as { titulo?: unknown }).titulo === "string" ? [{ titulo: String((a as { titulo: string }).titulo), estado: String((a as { estado?: unknown }).estado ?? "se_crearia") }] : []))
    : [];
  return { linea: typeof datos.linea === "string" ? datos.linea : null, arreglos };
}

function hora(fecha: Date): string {
  return fecha.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" });
}

/**
 * LA PANTALLA DE UN AGENTE DE ÁREA (ventas, marketing o sistemas): el resumen del día, lo que entregó cada subagente, los
 * mensajes internos que salieron (o se bloquearon) y el historial. Con el interruptor. La ven los mismos que ven
 * el Supervisor. Cada ruta (`/cliente/direccion/agente-de-ventas`, `/agente-de-marketing`) solo dice de qué área es.
 */
export async function PaginaDeAgenteDeArea({ area: AREA, searchParams }: { area: Area; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!esJefeDelNegocio(access)) redirect("/cliente/crm/mi-dia");
  const workspaceId = access.workspaceId;

  const pedida = (await searchParams).fecha;
  const fecha = typeof pedida === "string" && fechaValida(pedida) ? pedida : hoyEnBogota();

  const [activo, resumen, envios, historial, equipo, miembros, bienvenida] = await Promise.all([
    agenteActivo(AREA, workspaceId),
    leerResumenDelDia(workspaceId, AREA, fecha).catch(() => null),
    leerEnviosDelDia(workspaceId, AREA, fecha).catch(() => []),
    leerUltimosResumenes(workspaceId, AREA, 14).catch(() => []),
    leerEquipoDeAvisos(workspaceId),
    prisma.workspaceMember
      .findMany({
        where: { workspaceId, isActive: true, role: "AGENT" },
        select: { userId: true, user: { select: { name: true, email: true } } },
      })
      .catch(() => []),
    // Solo lectura; si falla, la tarjeta dice "sin dato" y el resto de la pantalla sigue igual.
    AREA === "ventas" ? numerosDeRespuestaBienvenida(workspaceId, fecha).catch(() => null) : Promise.resolve(null),
  ]);

  const conNumero = new Set(equipo.flatMap((persona) => [persona.userId, persona.soloDe]).filter(Boolean));
  const sinNumeroDeAvisos = miembros.filter((miembro) => !conNumero.has(miembro.userId)).map((miembro) => miembro.user?.name?.trim() || miembro.user?.email || miembro.userId);

  const datos: DatosDelPanel = {
    area: AREA,
    titulo: ETIQUETA_DE_AREA[AREA],
    activo,
    fecha,
    resumen: resumen
      ? {
          esPrueba: resumen.esPrueba,
          salioTarde: resumen.salioTarde,
          notaDeRetraso: resumen.notaDeRetraso,
          texto: resumen.resumen,
          numeros: resumen.numeros,
          meta: resumen.meta,
          subagentes: resumen.subagentes && typeof resumen.subagentes === "object" && !Array.isArray(resumen.subagentes) ? (resumen.subagentes as Record<string, unknown>) : {},
          sugeridos: Array.isArray(resumen.sugeridos) ? resumen.sugeridos.length : 0,
          ...(AREA === "marketing" ? lineaYRecomendacion(resumen.meta) : {}),
          ...(AREA === "sistemas" ? lineaYArreglos(resumen.meta) : {}),
        }
      : null,
    envios: envios.map((envio) => ({ ...envio, hora: hora(envio.creadoEn) })),
    historial: historial.map((dia) => ({ fecha: dia.fecha, esPrueba: dia.esPrueba, salioTarde: dia.salioTarde, resumen: dia.resumen })),
    bienvenida: AREA === "ventas" ? bienvenida?.serie ?? null : undefined,
    sinNumeroDeAvisos: AREA === "sistemas" ? [] : sinNumeroDeAvisos,
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5">
      <PanelAgenteDeArea datos={datos} />
    </div>
  );
}
