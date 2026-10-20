// Zonas protegidas: qué rutas del repo son de Meta Ads, del bot de ventas o del libro V3 (globs en la
// configuración de cada repo). Si el cambio toca una que el dueño no aprobó en la pantalla, la tarjeta
// queda ERROR y marcada con esa zona.

/** Un glob simple a expresión regular: "**" = cualquier cosa (también "/"), "*" = sin "/", "?" = un carácter. */
export function globARegex(glob) {
  let regex = "";
  for (let i = 0; i < glob.length; i += 1) {
    const caracter = glob[i];
    if (caracter === "*") {
      if (glob[i + 1] === "*") {
        // "**/" también calza con nada ("src/**/a.ts" calza "src/a.ts").
        if (glob[i + 2] === "/") {
          regex += "(?:.*/)?";
          i += 2;
        } else {
          regex += ".*";
          i += 1;
        }
      } else {
        regex += "[^/]*";
      }
    } else if (caracter === "?") {
      regex += "[^/]";
    } else {
      regex += caracter.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${regex}$`);
}

/**
 * Qué zonas tocan los archivos cambiados. `zonas` = { BOT_VENTAS: ["src/bot/**"], ... }.
 * Devuelve { zona: [archivos que la tocan] } solo de las que se tocan.
 */
export function zonasTocadas(archivos, zonas = {}) {
  const tocadas = {};
  for (const [zona, globs] of Object.entries(zonas)) {
    const regexes = (globs ?? []).map(globARegex);
    const suyos = archivos.filter((archivo) => regexes.some((regex) => regex.test(archivo.replace(/\\/g, "/"))));
    if (suyos.length) tocadas[zona] = suyos;
  }
  return tocadas;
}
