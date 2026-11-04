// Quita un archivo de la vista previa "Enviar N archivos" y dice qué archivo mostrar en grande
// después. Va aparte del componente para poder probarlo sin abrir el navegador.
//
// - Si se quita la grande, se muestra la siguiente; si era la última, la anterior.
// - Si se quita otra, la grande sigue siendo la misma (su índice baja en 1 si estaba después).
// - Un índice que no existe no cambia nada.
// - Si no queda ninguno, la lista sale vacía (la bandeja cierra la ventana sola).
export function quitarArchivo<T>(
  archivos: readonly T[],
  indice: number,
  activo: number,
): { archivos: T[]; activo: number } {
  if (!Number.isInteger(indice) || indice < 0 || indice >= archivos.length) {
    return { archivos: [...archivos], activo };
  }

  const quedan = archivos.filter((_, posicion) => posicion !== indice);
  if (quedan.length === 0) return { archivos: quedan, activo: 0 };

  let siguiente = activo;
  if (indice < activo) siguiente = activo - 1;
  // Si se quitó la grande, en su mismo índice queda la siguiente; si era la última, la anterior.
  return { archivos: quedan, activo: Math.max(0, Math.min(siguiente, quedan.length - 1)) };
}
