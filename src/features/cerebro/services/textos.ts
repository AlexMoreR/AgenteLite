import { bloqueDeConclusion } from "./reglas";

/** El bloque que se escribe al "pasar al cerebro": la conclusión con fecha y link a la tarjeta (sin base: sirve en la pantalla). */
export function textoDelPaso(datos: { conclusion: string; titulo: string; link: string; ahora?: Date }) {
  return bloqueDeConclusion({
    fecha: datos.ahora ?? new Date(),
    conclusion: datos.conclusion,
    tituloTarjeta: datos.titulo,
    linkTarjeta: datos.link,
  });
}
