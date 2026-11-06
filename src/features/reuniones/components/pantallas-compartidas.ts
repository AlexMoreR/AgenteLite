/*
  CUÁL PANTALLA SE VE EN GRANDE cuando varias personas comparten (lógica pura, se prueba con node).

  - Lo que la persona escogió tocando una miniatura se respeta mientras esa pantalla siga compartida.
  - Si alguien más empieza a compartir, la vista no salta: aparece como miniatura.
  - La excepción es tu propia pantalla: si la estás viendo sin haberla escogido y otra persona comparte,
    pasa a la de esa persona, porque tu pantalla ya la tienes enfrente.
*/

export type PantallaEnLaSala = { identidad: string; propia: boolean };
export type VistaDePantalla = { identidad: string | null; aMano: boolean };

export const SIN_PANTALLA: VistaDePantalla = { identidad: null, aMano: false };

/** Devuelve la misma `vista` si no cambia nada, para no volver a pintar de más. */
export function siguienteVista(pantallas: PantallaEnLaSala[], vista: VistaDePantalla): VistaDePantalla {
  const actual = pantallas.find((pantalla) => pantalla.identidad === vista.identidad);
  const deOtraPersona = pantallas.find((pantalla) => !pantalla.propia);
  if (actual) {
    if (actual.propia && !vista.aMano && deOtraPersona) {
      return { identidad: deOtraPersona.identidad, aMano: false };
    }
    return vista;
  }
  const nueva = deOtraPersona ?? pantallas[0];
  if (!nueva) {
    return vista.identidad === null && !vista.aMano ? vista : SIN_PANTALLA;
  }
  return { identidad: nueva.identidad, aMano: false };
}
