import { nombreDeLaRuta, type leerActividadDelEquipo } from "@/lib/actividad-del-equipo";
import { esVersionVieja, etiquetaDeVersion, versionDelServidor } from "@/lib/version-del-crm";
import { lineasDeLaPersona } from "@/features/actividad/services/lineas-de-la-persona";
import type { ultimaAccionEnCache } from "@/features/actividad/services/ultima-accion-en-cache";

type Actividad = Awaited<ReturnType<typeof leerActividadDelEquipo>>;
type UltimasAcciones = Awaited<ReturnType<typeof ultimaAccionEnCache>>;

/** Las clases de las líneas de debajo del nombre (las mismas de antes). */
const CLASES_DE_LA_ULTIMA_ACCION = "max-w-64 text-[11px] leading-snug text-muted-foreground";

/**
 * "Última conexión" y "Última acción" de una persona en Equipo (componente de servidor).
 * Las dos lecturas son las lentas: page.tsx las arranca sin esperarlas y pone este bloque dentro de
 * un `<Suspense>`, así la lista del equipo sale enseguida y esto llega después. Las promesas son las
 * mismas para todas las filas: se consultan una sola vez. Nunca fallan (traen su `.catch` desde
 * page.tsx); si una no trajo a la persona sale "Sin registro todavía" / "Sin acciones en 30 días".
 */
export async function UltimaAccionDelEquipo({
  actividad,
  ultimasAcciones,
  userId,
  ahora,
}: {
  actividad: Promise<Actividad>;
  ultimasAcciones: Promise<UltimasAcciones>;
  userId: string;
  ahora: Date;
}) {
  const [latidos, acciones] = await Promise.all([actividad, ultimasAcciones]);
  const latido = latidos[userId];
  const { conexion, conectadaAhora, accion } = lineasDeLaPersona({
    latido: latido
      ? {
          cuando: latido.cuando,
          // "Chats · Salón Rosa": la pantalla y, si estaba en un chat, cuál.
          donde: latido.donde || nombreDeLaRuta(latido.ruta),
          aparato: latido.dispositivo,
        }
      : null,
    ultimaAccion: acciones.get(userId) ?? null,
    ahora,
  });

  // "Versión abierta: v1.0.N" y, si es más vieja que la del servidor, cuál es la actual.
  // Sin dato de versión la línea no sale; sin versión del servidor (desarrollo) no dice si es vieja.
  const servidor = versionDelServidor();
  const versionAbierta = latido?.version
    ? `Versión abierta: ${etiquetaDeVersion(latido.version)}${
        esVersionVieja(latido.version, servidor) ? ` · vieja (la actual es ${etiquetaDeVersion(servidor)})` : ""
      }`
    : null;

  return (
    <>
      <span className={CLASES_DE_LA_ULTIMA_ACCION}>
        {conectadaAhora ? <span className="mr-1 font-medium text-foreground">🟢 Conectada ahora ·</span> : null}
        {conexion}
      </span>
      {versionAbierta ? <span className={CLASES_DE_LA_ULTIMA_ACCION}>{versionAbierta}</span> : null}
      <span className={CLASES_DE_LA_ULTIMA_ACCION}>{accion}</span>
    </>
  );
}

/** Lo que se ve mientras llegan la última conexión y la última acción. */
export function UltimaAccionDelEquipoCargando() {
  return <span className={CLASES_DE_LA_ULTIMA_ACCION}>Cargando última conexión y acción…</span>;
}
