import { expect, test, type Page, type Route } from "@playwright/test";
import { BASE_URL, E2E_EMAIL, E2E_PASSWORD, FALTAN_SECRETOS } from "./ajustes";

/**
 * Chats, parte 3: fotos, videos y stickers con el lugar reservado, sin saltos.
 *
 * La prueba de la parte 2 abre los primeros chats de la lista: no garantiza que haya medios ni
 * mira si una burbuja cambia de alto. Esta agrega medios de prueba a la respuesta de `/live`,
 * SOLO en este navegador (no se guardan en ningun lado), demora sus imagenes y mide cuadro por
 * cuadro el alto de cada burbuja y la distancia al final.
 *
 * SOLO lectura y SIN marcar leidos: no envia nada, y todo /live que abriria el chat va con
 * `precarga=1`. Los archivos de prueba se responden aca mismo: nunca llegan al servidor.
 *
 * Solo corre con E2E_MEDIR_CHATS=1 (no la nocturna):
 *   E2E_MEDIR_CHATS=1 E2E_BASE_URL=<servidor> npx playwright test -c e2e chat-medios-sin-saltos
 */

const MEDIR = process.env.E2E_MEDIR_CHATS === "1";
const LIMITE_FUERA_DEL_FINAL_PX = 10;
const DEMORA_DE_LAS_IMAGENES_MS = 1500;
const PREFIJO = "e2e-medios";
// Un JPEG de 1x1: alcanza para comprobar que el video muestra un poster sin bajar nada.
const POSTER =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const TAMANOS = [
  { nombre: "PC", viewport: { width: 1366, height: 860 }, movil: false },
  { nombre: "celular 375x812", viewport: { width: 375, height: 812 }, movil: true },
] as const;

type Cuadro = { distancia: number; altos: Record<string, number> };

for (const tamano of TAMANOS) {
  test.describe(`Fotos y videos sin saltos (${tamano.nombre})`, () => {
    test.skip(!MEDIR, "Solo con E2E_MEDIR_CHATS=1 (medicion a pedido, no la nocturna).");
    test.skip(FALTAN_SECRETOS, "Faltan E2E_EMAIL y/o E2E_PASSWORD.");

    test("abrir un chat con fotos, videos y sticker: ninguna burbuja cambia de alto", async ({ browser }) => {
      const contexto = await browser.newContext({
        baseURL: BASE_URL,
        viewport: tamano.viewport,
        isMobile: tamano.movil,
        hasTouch: tamano.movil,
        locale: "es-CO",
        timezoneId: "America/Bogota",
      });
      const videosPedidos: string[] = [];
      contexto.on("request", (pedido) => {
        if (pedido.resourceType() === "media" || /\.(mp4|webm|3gp|mov)(\?|$)/i.test(pedido.url())) {
          videosPedidos.push(pedido.url());
        }
      });
      await contexto.route(`**/uploads/${PREFIJO}-*`, (ruta) => responderArchivoDePrueba(ruta));
      await contexto.route("**/api/cliente/chats/live?**", async (ruta) => {
        const url = new URL(ruta.request().url());
        if (!url.searchParams.has("beforeMessageId")) {
          url.searchParams.set("precarga", "1");
        }
        const respuesta = await ruta.fetch({ url: url.toString() });
        const cuerpo = (await respuesta.json().catch(() => null)) as {
          conversation?: { messages?: Array<Record<string, unknown>> };
        } | null;
        const mensajes = cuerpo?.conversation?.messages;
        if (Array.isArray(mensajes) && mensajes.length > 0 && !url.searchParams.has("beforeMessageId")) {
          mensajes.push(...mediosDePrueba(mensajes.at(-1)!));
        }
        await ruta.fulfill({ response: respuesta, json: cuerpo ?? undefined });
      });

      const pagina = await contexto.newPage();
      await iniciarSesion(pagina);
      const fila = pagina.locator('a[href*="/cliente/chats?chatKey=agent:"]:visible').first();
      await fila.waitFor({ state: "visible", timeout: 20_000 });
      await pagina.addScriptTag({ content: SCRIPT_DE_MEDICION });
      await pagina.evaluate(() => (window as unknown as { __medios: { empezar: () => void } }).__medios.empezar());
      await fila.click();
      await expect(pagina.locator(`.chat-messages-scroll [data-message-id^="${PREFIJO}"]`).first()).toBeAttached({
        timeout: 20_000,
      });
      // Las imagenes de prueba tardan 1,5 s: se mide hasta bastante despues.
      await pagina.waitForTimeout(DEMORA_DE_LAS_IMAGENES_MS + 3000);
      const cuadros = await pagina.evaluate(
        () => (window as unknown as { __medios: { terminar: () => Cuadro[] } }).__medios.terminar(),
      );

      const conMedios = cuadros.filter((cuadro) => Object.keys(cuadro.altos).some((id) => id.startsWith(PREFIJO)));
      expect(conMedios.length, "se pintaron los medios de prueba").toBeGreaterThan(0);
      const primero: Record<string, number> = {};
      const cambios: string[] = [];
      for (const cuadro of conMedios) {
        for (const [id, alto] of Object.entries(cuadro.altos)) {
          if (!id.startsWith(PREFIJO)) continue;
          primero[id] ??= alto;
          if (Math.abs(alto - primero[id]!) > 1) cambios.push(`${id}: ${primero[id]} -> ${alto} px`);
        }
        expect(cuadro.distancia, "la vista queda al final").toBeLessThanOrEqual(LIMITE_FUERA_DEL_FINAL_PX);
      }
      expect(cambios, "ninguna burbuja con medios cambia de alto al cargar").toEqual([]);
      expect(videosPedidos, "ningun video se descarga al abrir el chat").toEqual([]);
      test.info().annotations.push({
        type: "medicion",
        description: `${conMedios.length} cuadros con medios, peor distancia ${Math.max(
          0,
          ...conMedios.map((cuadro) => cuadro.distancia),
        )} px, videos pedidos ${videosPedidos.length}`,
      });
      await contexto.close();
    });
  });
}

/* ---------------------------------------------------------------- ayudantes */

async function iniciarSesion(pagina: Page) {
  await pagina.goto("/login");
  await pagina.getByPlaceholder("correo@empresa.com").fill(E2E_EMAIL);
  await pagina.getByPlaceholder("Tu contrasena").fill(E2E_PASSWORD);
  await pagina.getByRole("button", { name: "Entrar", exact: true }).click();
  await pagina.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  await pagina.goto("/cliente/chats");
}

/** Los medios que se agregan al final del chat: con tamaño, sin tamaño, video con poster y sticker. */
function mediosDePrueba(ultimo: Record<string, unknown>) {
  const base = {
    ...ultimo,
    direction: "INBOUND",
    authorType: "contact",
    content: "",
    createdAt: new Date().toISOString(),
  };
  const nodo = (tipo: string, datos: Record<string, unknown>) => ({ evolution: { data: { Message: { [tipo]: datos } } } });
  const archivo = (nombre: string, ancho: number, alto: number) => `/uploads/${PREFIJO}-${nombre}.svg?w=${ancho}&h=${alto}`;
  return [
    { ...base, id: `${PREFIJO}-foto-vertical`, type: "IMAGE", mediaUrl: archivo("vertical", 1080, 1920),
      rawPayload: nodo("imageMessage", { width: 1080, height: 1920 }) },
    { ...base, id: `${PREFIJO}-foto-sin-tamano`, type: "IMAGE", mediaUrl: archivo("sin-tamano", 900, 1600),
      content: "Foto sin tamaño (medicion, no se guarda)", rawPayload: nodo("imageMessage", {}) },
    { ...base, id: `${PREFIJO}-video`, type: "VIDEO", mediaUrl: `/uploads/${PREFIJO}-video.mp4`,
      rawPayload: nodo("videoMessage", { width: 480, height: 848, JPEGThumbnail: POSTER }) },
    { ...base, id: `${PREFIJO}-sticker`, type: "STICKER", mediaUrl: archivo("sticker", 512, 512),
      rawPayload: nodo("stickerMessage", {}) },
    { ...base, id: `${PREFIJO}-foto-horizontal`, type: "IMAGE", mediaUrl: archivo("horizontal", 1600, 1200),
      rawPayload: nodo("imageMessage", { width: 1600, height: 1200 }) },
  ];
}

async function responderArchivoDePrueba(ruta: Route) {
  const url = new URL(ruta.request().url());
  if (url.pathname.endsWith(".mp4")) {
    // Si el navegador lo pide, la prueba ya fallo (videosPedidos); no hace falta servir nada.
    return ruta.fulfill({ status: 404, body: "" });
  }
  await new Promise((listo) => setTimeout(listo, DEMORA_DE_LAS_IMAGENES_MS));
  const ancho = Number(url.searchParams.get("w")) || 100;
  const alto = Number(url.searchParams.get("h")) || 100;
  return ruta.fulfill({
    contentType: "image/svg+xml",
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}"><rect width="100%" height="100%" fill="#7a9"/></svg>`,
  });
}

// Corre dentro de la pagina: en cada cuadro anota el alto de cada burbuja y la distancia al final.
const SCRIPT_DE_MEDICION = `(() => {
  let cuadros = [];
  let midiendo = false;
  function cuadro() {
    if (!midiendo) return;
    const el = document.querySelector(".chat-messages-scroll");
    if (el) {
      const altos = {};
      for (const n of el.querySelectorAll("[data-message-id]")) {
        altos[n.getAttribute("data-message-id") || ""] = Math.round(n.getBoundingClientRect().height);
      }
      cuadros.push({ distancia: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight), altos });
    }
    requestAnimationFrame(cuadro);
  }
  window.__medios = {
    empezar() { cuadros = []; midiendo = true; requestAnimationFrame(cuadro); },
    terminar() { midiendo = false; return cuadros; },
  };
})();`;
