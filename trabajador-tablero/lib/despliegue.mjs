// El contenedor del CRM mientras se espera el despliegue (10-nov-2026). Solo lectura, por ssh (config.ssh.despliegue).
//
// El servidor de EEUU tarda 10-22 min en tomar cada versión y el Coordinador, con 8 min de espera, declaraba "no arrancó" y
// deshacía subidas buenas (T-714: la versión nueva apareció a los 17 min). Ahora el tiempo solo NUNCA deshace: para deshacer
// hace falta ver la falla. Esto lee el contenedor y dice si el NUEVO (otro id que el de antes de subir) se cayó, se reinicia
// o está unhealthy. El contenedor viejo corriendo no dice nada: el despliegue todavía no llegó.
//
// ssh.despliegue es un comando remoto que imprime "<id> <estado> <salud> <reinicios>", por ejemplo:
//   docker inspect -f '{{.Id}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}sin-salud{{end}} {{.RestartCount}}' $(docker ps -a -q --latest --filter name=CONTENEDOR_CRM)
import { correr } from "./procesos.mjs";

/** Cuántas lecturas seguidas tiene que verse la falla del contenedor nuevo para deshacer (una sola puede ser el arranque). */
export const LECTURAS_PARA_FALLA = 2;

const ESTADOS = "created|running|restarting|exited|paused|dead|removing";

/** "<id> <estado> <salud> <reinicios>" -> { id, estado, salud, reinicios }, o null si la salida no lo dice. Puro. */
export function estadoDelDespliegue(salida) {
  const calce = String(salida ?? "").match(new RegExp(`\\b([0-9a-f]{12,64})\\s+(${ESTADOS})\\s+(\\S+)\\s+(\\d+)\\b`, "i"));
  if (!calce) return null;
  return { id: calce[1].toLowerCase(), estado: calce[2].toLowerCase(), salud: calce[3].toLowerCase(), reinicios: Number(calce[4]) };
}

/**
 * Lo que se ve del contenedor ahora, o null si no hay ssh.despliegue o no se pudo leer (ssh caído, contenedor que no
 * aparece mientras Portainer lo recrea): leer mal nunca es evidencia de falla.
 */
export async function leerElDespliegue(config, { senal, env } = {}) {
  if (!config.ssh?.despliegue) return null;
  const resultado = await correr([...config.ssh.comando, config.ssh.destino, config.ssh.despliegue], { timeoutMs: 60_000, senal, env });
  if (resultado.codigo !== 0 || resultado.vencido || resultado.cancelado) return null;
  return estadoDelDespliegue(resultado.salida);
}

/**
 * ¿El contenedor NUEVO falló? `antes` es lo leído antes de subir y `ahora` lo de esta vuelta. Devuelve la falla en palabras
 * o null: sin las dos lecturas, o con el mismo contenedor de antes, no se sabe nada. Puro.
 */
export function fallaDelContenedorNuevo(antes, ahora) {
  if (!antes || !ahora || ahora.id === antes.id) return null;
  const cual = `el contenedor nuevo del CRM (${ahora.id.slice(0, 12)})`;
  if (ahora.estado === "exited" || ahora.estado === "dead") return `${cual} se cayó (${ahora.estado})`;
  if (ahora.estado === "restarting") return `${cual} se está reiniciando una y otra vez`;
  if (ahora.reinicios > 0) return `${cual} se reinició ${ahora.reinicios} ${ahora.reinicios === 1 ? "vez" : "veces"}`;
  if (ahora.salud === "unhealthy") return `${cual} está unhealthy`;
  return null;
}

/** En pocas palabras, para el mensaje de "sin confirmar": qué contenedor corre. */
export function textoDelDespliegue(antes, ahora) {
  if (!ahora) return "el contenedor no se pudo leer (falta ssh.despliegue o no contestó)";
  const nuevo = antes && ahora.id !== antes.id ? "nuevo" : antes ? "el mismo de antes de subir" : "sin lectura de antes";
  return `contenedor ${ahora.id.slice(0, 12)} (${nuevo}): ${ahora.estado}, salud ${ahora.salud}, ${ahora.reinicios} reinicio(s)`;
}
