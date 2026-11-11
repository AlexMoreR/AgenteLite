/*
  LA FOTO DE LA BANDEJA (Alex, 11-11-2026: "que la copia guardada sea IDENTICA a la lista final").

  Antes, al abrir Chats en el celular se veian dos brincos:
    1. la copia guardada (lista-desde-guardado) era una version simplificada de la fila: sin
       pastillas, sin asesora, sin linea, sin etiquetas, sin etapa y sin los fijados arriba;
    2. despues llegaba la lista real... que tampoco era la final: el servidor la manda sin los
       fijados arriba y sin las pastillas de cada persona, y eso se acomodaba recien en el navegador.

  Ahora se guarda una FOTO de la bandeja tal como se vio la ultima vez: el HTML de la barra (buscador
  y pastillas con sus numeros) y de las filas que se veian, con las mismas clases. Al abrir, un
  script chiquito (escrito en loading.tsx, corre antes que cualquier otro JavaScript) la pone encima,
  en el mismo lugar de la pantalla. Debajo la lista real se arma y se acomoda; cuando ya esta
  quieta, la bandeja quita la foto (quitarFotoDeLaBandeja). Como la foto es de la misma lista, lo
  unico que cambia es lo nuevo.

  Reglas:
  - Es del mismo dueño que el resto del guardado (negocio + usuario + version, ver dueno.ts) y vive
    bajo el prefijo "aglite:lista-guardada", asi que se borra con todo lo demas al cambiar de dueño.
  - Una foto por vista (la direccion sin chatKey), las MAXIMO_DE_FOTOS mas recientes; con mas de 24 h
    no se usa. Solo si la pantalla mide lo mismo que cuando se tomo (otro ancho = otra forma).
  - Es de SOLO MIRAR: sin enlaces (se les quita el href), el buscador no se puede escribir y los
    toques se tragan. Dura lo que tarda la lista real, con un tope de TOPE_DE_LA_FOTO_MS.
  - Se toma solo con la lista quieta: arriba del todo, sin buscar, sin la lista atenuada.
*/

export const ID_DE_LA_FOTO = "foto-de-la-bandeja";
const CLAVE_DEL_DUENO = "aglite:dueno-del-guardado";
const PREFIJO = "aglite:lista-guardada:foto:";
const VERSION_DE_LA_FOTO = 1;
const MAXIMO_DE_FOTOS = 3;
/** Una foto mas grande que esto no se guarda (una lista normal pesa 30-60 kB). */
const MAXIMO_DE_CARACTERES = 250_000;

type Foto = {
  version: number;
  guardadoEn: number;
  ruta: string;
  /** Tamaño de la pantalla cuando se tomo. */
  vw: number;
  vh: number;
  /** Donde estaba la bandeja en la pantalla. */
  x: number;
  y: number;
  w: number;
  h: number;
  html: string;
};

/** La vista de la bandeja: la direccion sin chatKey (abrir un chat no cambia la lista). */
export function rutaDeLaVista(pathname: string, search: string): string {
  const parametros = new URLSearchParams(search);
  parametros.delete("chatKey");
  parametros.sort();
  return `${pathname}?${parametros.toString()}`;
}

/**
 * El script que pone la foto encima de la bandeja.
 *
 * Es TEXTO a proposito, y lo mismo corre en los dos lugares:
 * - loading.tsx lo escribe en un <script> para que corra apenas llega el HTML, antes del JavaScript
 *   de la pagina;
 * - al llegar a Chats desde otra pantalla (ahi un <script> del HTML no corre) lo corre
 *   mostrarFotoDeLaBandeja.
 * Escribirlo como funcion y pasarla con toString() no es seguro: cada compilador le agrega sus
 * ayudantes (esbuild mete `__name(...)`) y el script reventaria en silencio. Por eso las claves estan
 * repetidas aca adentro, sin imports, y el codigo es simple. La prueba (foto-de-la-bandeja.test.ts)
 * lo corre con solo `window` y `document`.
 */
const SCRIPT_DE_LA_FOTO = `(function () {
  try {
    var id = "foto-de-la-bandeja";
    if (document.getElementById(id)) return;
    var parametros = new URLSearchParams(window.location.search);
    if (parametros.get("chatKey")) return;
    parametros.sort();
    var ruta = window.location.pathname + "?" + parametros.toString();
    var dueno = window.localStorage.getItem("aglite:dueno-del-guardado");
    if (!dueno) return;
    var crudo = window.localStorage.getItem("aglite:lista-guardada:foto:" + dueno);
    if (!crudo) return;
    var todas = JSON.parse(crudo);
    var foto = todas && typeof todas === "object" ? todas[ruta] : null;
    if (!foto || foto.version !== 1 || typeof foto.html !== "string") return;
    var edad = Date.now() - foto.guardadoEn;
    if (!(edad >= -300000 && edad <= 86400000)) return;
    if (foto.vw !== window.innerWidth || Math.abs(foto.vh - window.innerHeight) > 4) return;

    var capa = document.createElement("div");
    capa.id = id;
    capa.setAttribute("aria-hidden", "true");
    capa.style.cssText = "position:fixed;z-index:60;overflow:hidden;pointer-events:auto;left:" + foto.x +
      "px;top:" + foto.y + "px;width:" + foto.w + "px;height:" + foto.h + "px;";
    capa.innerHTML = foto.html;
    /* Solo mirar: ningun toque llega a lo de abajo ni hace nada. */
    capa.addEventListener("click", function (evento) { evento.preventDefault(); evento.stopPropagation(); }, true);
    capa.addEventListener("focusin", function () {
      var activo = document.activeElement;
      if (activo && activo.blur) activo.blur();
    });
    document.body.appendChild(capa);

    var quitar = function () {
      var actual = document.getElementById(id);
      if (actual && actual.parentNode) actual.parentNode.removeChild(actual);
      window.removeEventListener("resize", quitar);
    };
    /* Tope: si la pagina no llega a quitarla (un error), no se queda tapando la bandeja. */
    window.setTimeout(quitar, 8000);
    /* Girar el celular o cambiar el tamano cambia la forma: la foto ya no calza. */
    window.addEventListener("resize", quitar);
  } catch (error) {}
})();`;

/** El texto del <script> que pone la foto apenas llega el HTML (loading.tsx). */
export function scriptDeLaFoto(): string {
  return SCRIPT_DE_LA_FOTO;
}

/** Pone la foto encima de la bandeja (llegando a Chats desde otra pantalla). Devuelve si quedo puesta. */
export function mostrarFotoDeLaBandeja(): boolean {
  try {
    new Function(SCRIPT_DE_LA_FOTO)();
  } catch {
    // Sin foto se ven las siluetas.
  }
  return hayFotoDeLaBandeja();
}

/** Saca la foto: la lista real ya esta lista debajo. Nunca lanza. */
export function quitarFotoDeLaBandeja() {
  try {
    const capa = document.getElementById(ID_DE_LA_FOTO);
    capa?.remove();
  } catch {
    // Prescindible.
  }
}

export function hayFotoDeLaBandeja(): boolean {
  try {
    return Boolean(document.getElementById(ID_DE_LA_FOTO));
  } catch {
    return false;
  }
}

/**
 * Arma el HTML de la foto: la bandeja entera, pero en la lista solo las filas que se ven, sin
 * enlaces, sin ids repetidos y sin el resaltado del chat abierto.
 */
export function armarHtmlDeLaFoto(bandeja: HTMLElement, lista: HTMLElement, altoDeFila: number): string | null {
  const clon = bandeja.cloneNode(true) as HTMLElement;
  // Ocupa justo la caja de la foto (que mide lo que media la bandeja), ni mas ni menos.
  clon.style.width = "100%";
  clon.style.height = "100%";
  const listaDelClon = clon.querySelector<HTMLElement>("[data-lista-de-chats]");
  if (!listaDelClon) return null;

  const filas = Array.from(lista.children).filter((hijo) => hijo.tagName === "A");
  const cuantas = Math.max(1, Math.ceil(lista.clientHeight / altoDeFila) + 1);
  listaDelClon.replaceChildren(...filas.slice(0, cuantas).map((fila) => fila.cloneNode(true)));
  listaDelClon.scrollTop = 0;

  for (const enlace of Array.from(clon.querySelectorAll("a[href]"))) {
    enlace.removeAttribute("href");
  }
  for (const conId of Array.from(clon.querySelectorAll("[id]"))) {
    conId.removeAttribute("id");
  }
  for (const caja of Array.from(clon.querySelectorAll("input, textarea"))) {
    caja.setAttribute("readonly", "");
    caja.setAttribute("tabindex", "-1");
  }
  for (const boton of Array.from(clon.querySelectorAll("button"))) {
    boton.setAttribute("tabindex", "-1");
  }
  // El chat abierto (en la compu) no esta abierto al volver a entrar.
  for (const fila of Array.from(listaDelClon.querySelectorAll(".bg-primary\\/10"))) {
    fila.classList.remove("bg-primary/10");
  }
  return clon.outerHTML;
}

function leerFotos(dueno: string): Record<string, Foto> {
  try {
    const crudo = window.localStorage.getItem(`${PREFIJO}${dueno}`);
    const datos = crudo ? (JSON.parse(crudo) as unknown) : null;
    return datos && typeof datos === "object" && !Array.isArray(datos) ? (datos as Record<string, Foto>) : {};
  } catch {
    return {};
  }
}

/** Guarda la foto de esta vista (las MAXIMO_DE_FOTOS mas recientes). Nunca lanza. */
export function guardarFotoDeLaBandeja(bandeja: HTMLElement, lista: HTMLElement, altoDeFila: number) {
  try {
    if (typeof window === "undefined" || hayFotoDeLaBandeja()) return;
    const dueno = window.localStorage.getItem(CLAVE_DEL_DUENO);
    if (!dueno) return;
    const lugar = bandeja.getBoundingClientRect();
    if (lugar.width < 200 || lugar.height < 200) return;
    const html = armarHtmlDeLaFoto(bandeja, lista, altoDeFila);
    if (!html || html.length > MAXIMO_DE_CARACTERES) return;

    const ruta = rutaDeLaVista(window.location.pathname, window.location.search);
    const foto: Foto = {
      version: VERSION_DE_LA_FOTO,
      guardadoEn: Date.now(),
      ruta,
      vw: window.innerWidth,
      vh: window.innerHeight,
      x: Math.round(lugar.left),
      y: Math.round(lugar.top),
      w: Math.round(lugar.width),
      h: Math.round(lugar.height),
      html,
    };
    const fotos = leerFotos(dueno);
    fotos[ruta] = foto;
    const recientes = Object.entries(fotos)
      .filter(([, otra]) => otra && typeof otra.guardadoEn === "number")
      .sort((a, b) => b[1].guardadoEn - a[1].guardadoEn)
      .slice(0, MAXIMO_DE_FOTOS);
    window.localStorage.setItem(`${PREFIJO}${dueno}`, JSON.stringify(Object.fromEntries(recientes)));
  } catch {
    // Sin espacio o sin permiso: la proxima vez se ven las siluetas.
  }
}
