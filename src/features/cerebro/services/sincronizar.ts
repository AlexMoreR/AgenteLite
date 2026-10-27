import { recortarTexto, esLegible, planificarSincronizacion, type ArchivoDeDrive, type CopiaDeArchivo } from "./reglas";
import type { ClienteDeDrive } from "./drive";

/*
  CEREBRO: la sincronización. El Drive manda: lo que cambió en el Drive reemplaza la copia; lo que ya no
  está en el Drive se marca "ya no está en Drive" (la fila se queda, el texto también, por si hay que
  recuperarlo). El CRM nunca borra nada en el Drive: esto solo escribe en la copia de la base.
*/

/** Lo que la sincronización necesita de la base (se cambia por uno falso en las pruebas). */
export type AlmacenDelCerebro = {
  copia(workspaceId: string): Promise<CopiaDeArchivo[]>;
  guardar(
    workspaceId: string,
    archivo: ArchivoDeDrive,
    texto: { texto: string | null; truncado: boolean } | null,
    ahora: Date,
  ): Promise<void>;
  marcarAusentes(workspaceId: string, driveIds: string[], ahora: Date): Promise<void>;
  anotarSincronizacion(workspaceId: string, resultado: { ok: boolean; error: string | null }, ahora: Date): Promise<void>;
};

export type ResultadoDeSincronizacion = {
  ok: boolean;
  nuevos: number;
  cambiados: number;
  movidos: number;
  ausentes: number;
  /** Filas que estaban en la copia y ahora quedan fuera por seIgnora (marcadas, no borradas). */
  ignorados: number;
  sinCambio: number;
  noSePudoLeer: string[];
  truncado: boolean;
  error?: string;
};

export async function sincronizarConAlmacen(datos: {
  workspaceId: string;
  carpetaId: string;
  drive: ClienteDeDrive;
  almacen: AlmacenDelCerebro;
  ahora?: Date;
}): Promise<ResultadoDeSincronizacion> {
  const { workspaceId, carpetaId, drive, almacen } = datos;
  const ahora = datos.ahora ?? new Date();
  try {
    // Si la carpeta ya no existe o se perdió el permiso, esto falla ACÁ y la copia queda como estaba.
    await drive.metadatos(carpetaId);
    const [recorrido, copia] = await Promise.all([drive.recorrer(carpetaId), almacen.copia(workspaceId)]);
    // Un recorrido cortado por el tope no sirve para decir qué ya no está: no se marca nada como ausente.
    const plan = planificarSincronizacion(recorrido.archivos, copia);
    if (recorrido.truncado) plan.ausentes = [];

    const noSePudoLeer: string[] = [];
    for (const archivo of [...plan.nuevos, ...plan.cambiados]) {
      let texto: { texto: string | null; truncado: boolean } | null = { texto: null, truncado: false };
      if (!archivo.esCarpeta && esLegible(archivo.nombre, archivo.tipo)) {
        try {
          const bajado = await drive.leerTexto(archivo.driveId, archivo.nombre, archivo.tipo);
          texto = bajado === null ? { texto: null, truncado: false } : recortarTexto(bajado);
        } catch (fallo) {
          // Un documento que no se pudo bajar no tumba el resto: queda como estaba y se reintenta en la próxima.
          noSePudoLeer.push(`${archivo.ruta}: ${fallo instanceof Error ? fallo.message : "error"}`);
          continue;
        }
      }
      await almacen.guardar(workspaceId, archivo, texto, ahora);
    }
    // Solo cambió el nombre o el lugar: la ficha se actualiza y el texto se deja.
    for (const archivo of plan.movidos) await almacen.guardar(workspaceId, archivo, null, ahora);
    if (plan.ausentes.length) await almacen.marcarAusentes(workspaceId, plan.ausentes, ahora);
    // Lo ignorado por regla (.git, .obsidian, export-dudas, .png) sale del cerebro aunque el recorrido venga truncado.
    // Se marca igual que "ya no está" (enDrive = false): la fila se queda, no se borra nada.
    if (plan.ignorados.length) await almacen.marcarAusentes(workspaceId, plan.ignorados, ahora);

    await almacen.anotarSincronizacion(workspaceId, { ok: true, error: null }, ahora);
    return {
      ok: true,
      nuevos: plan.nuevos.length,
      cambiados: plan.cambiados.length,
      movidos: plan.movidos.length,
      ausentes: plan.ausentes.length,
      ignorados: plan.ignorados.length,
      sinCambio: plan.igualesSinCambio,
      noSePudoLeer,
      truncado: recorrido.truncado,
    };
  } catch (fallo) {
    const error = fallo instanceof Error ? fallo.message : "No se pudo sincronizar";
    await almacen.anotarSincronizacion(workspaceId, { ok: false, error }, ahora).catch(() => undefined);
    return { ok: false, nuevos: 0, cambiados: 0, movidos: 0, ausentes: 0, ignorados: 0, sinCambio: 0, noSePudoLeer: [], truncado: false, error };
  }
}
