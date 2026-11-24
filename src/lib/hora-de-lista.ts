/**
 * Cómo se muestra la fecha del último mensaje en la lista de chats, igual que en WhatsApp:
 *  - hoy:            la hora ("07:35 p. m.")
 *  - ayer:           "Ayer"
 *  - últimos 6 días: el día de la semana ("Martes")
 *  - más atrás:      la fecha "dd/mm/aaaa"
 * Los días se cuentan en hora de Bogotá, sin importar dónde corra el navegador.
 */

const ZONA = "America/Bogota";

const hora = new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit", timeZone: ZONA });
const diaDeSemana = new Intl.DateTimeFormat("es-CO", { weekday: "long", timeZone: ZONA });
const fechaCorta = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: ZONA });
const partes = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: ZONA });

/** Número de día (días desde 1970) del calendario de Bogotá. */
function diaDeBogota(fecha: Date): number {
  const [a, m, d] = partes.format(fecha).split("-").map(Number);
  return Math.floor(Date.UTC(a, m - 1, d) / 86_400_000);
}

const limpiar = (texto: string) => texto.replace(/ /g, " ");

export function horaDeLista(fecha: Date, ahora: Date = new Date()): string {
  if (Number.isNaN(fecha.getTime())) return "";
  const dias = diaDeBogota(ahora) - diaDeBogota(fecha);
  if (dias <= 0) return limpiar(hora.format(fecha));
  if (dias === 1) return "Ayer";
  if (dias < 7) {
    const nombre = diaDeSemana.format(fecha);
    return nombre.charAt(0).toUpperCase() + nombre.slice(1);
  }
  return limpiar(fechaCorta.format(fecha));
}
