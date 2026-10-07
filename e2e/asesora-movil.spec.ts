import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { CONTEXTO_MOVIL, E2E_EMAIL, E2E_PASSWORD, FALTAN_SECRETOS } from "./ajustes";

/**
 * Fase 0: recorrido de la asesora en el celular, SOLO lectura y navegacion.
 * - No envia mensajes, no sube archivos, no calcula envios ni crea ubicaciones en Gestion.
 * - No usa data-testid (la app no los tiene todavia): selectores por rol, texto o aria-label.
 *   Los marcados "FRAGIL" se rompen si cambia ese texto en la interfaz.
 *
 * Las pruebas comparten una sola pagina y van en orden (serial): si una falla, las siguientes
 * se saltan. Cada paso va en test.step() y su tiempo queda en e2e-results/tiempos.json.
 */

test.describe.configure({ mode: "serial" });

test.describe("Asesora en celular (solo lectura)", () => {
  test.skip(
    FALTAN_SECRETOS,
    "Faltan los secretos E2E_EMAIL y/o E2E_PASSWORD: se saltan las pruebas E2E (no es un fallo).",
  );

  let contexto: BrowserContext;
  let pagina: Page;
  let hayChat = false;
  let chatAbierto = false;
  let fichaAbierta = false;

  test.beforeAll(async ({ browser }) => {
    contexto = await browser.newContext({ ...CONTEXTO_MOVIL });
    pagina = await contexto.newPage();
  });

  test.afterAll(async () => {
    await contexto?.close();
  });

  test("1. Entrar con la cuenta de asesora", async () => {
    await test.step("abrir /login", async () => {
      await pagina.goto("/login");
      // FRAGIL: placeholder del formulario de acceso (src/components/auth/login-form.tsx).
      await expect(pagina.getByPlaceholder("correo@empresa.com")).toBeVisible();
    });

    await test.step("enviar credenciales y llegar al panel", async () => {
      await pagina.getByPlaceholder("correo@empresa.com").fill(E2E_EMAIL);
      await pagina.getByPlaceholder("Tu contrasena").fill(E2E_PASSWORD);
      await pagina.getByRole("button", { name: "Entrar", exact: true }).click();
      await pagina.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
    });
  });

  test("2. Cargar la lista de chats", async () => {
    await test.step("abrir /cliente/chats", async () => {
      await pagina.goto("/cliente/chats");
      // FRAGIL: el boton "Cambiar filtro" (appsidebar.tsx) es lo primero fijo de la bandeja.
      await expect(pagina.getByRole("button", { name: "Cambiar filtro" })).toBeVisible();
    });

    await test.step("esperar las filas de chats", async () => {
      const filas = filasDeChats(pagina);
      // Si el negocio de prueba no tiene chats, no hay filas: no es un fallo, solo se marca.
      hayChat = await filas
        .first()
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      test.info().annotations.push({
        type: "chats",
        description: hayChat ? `${await filas.count()} chats visibles` : "sin chats en el negocio de prueba",
      });
    });
  });

  test("3. Abrir un chat", async () => {
    test.skip(!hayChat, "El negocio de prueba no tiene chats: no hay cual abrir.");

    await test.step("tocar el primer chat y ver el historial", async () => {
      await filasDeChats(pagina).first().click();
      // En el celular el chat abierto muestra "Volver a chats" (solo movil, md:hidden).
      await expect(pagina.getByRole("link", { name: "Volver a chats" })).toBeVisible();
      await expect(botonFicha(pagina)).toBeVisible();
      // Espera a que termine el "Cargando conversacion" si aparece.
      await expect(pagina.getByLabel("Cargando conversación")).toHaveCount(0, { timeout: 30_000 });
    });
    chatAbierto = true;
  });

  test("4. Abrir la ficha del cliente", async () => {
    test.skip(!chatAbierto, "No hay chat abierto.");

    await test.step("tocar la foto del contacto y ver la ficha", async () => {
      await botonFicha(pagina).click();
      // La ficha en el celular es un Sheet (role=dialog) con titulo "Contacto".
      await expect(fichaMovil(pagina)).toBeVisible();
    });
    fichaAbierta = true;
  });

  test("5. Abrir el panel de envio (sin calcular)", async () => {
    test.skip(!fichaAbierta, "No hay ficha abierta.");
    const ficha = fichaMovil(pagina);
    // FRAGIL: texto del boton en chat-conversation-panel.tsx. Solo aparece si el chat tiene contacto.
    const botonEnvio = ficha.getByRole("button", { name: /Calcular env[ií]o/ });
    test.skip((await botonEnvio.count()) === 0, "El chat no tiene contacto: no hay panel de envio.");

    await test.step("tocar 'Calcular envio' y ver el panel", async () => {
      await botonEnvio.click();
      // NUNCA se escribe en la caja ni se elige/agrega ubicacion: eso consulta o ESCRIBE en Gestion.
      // Se acepta la caja de busqueda o un aviso de Gestion (el negocio de prueba no tiene conexion).
      await expect(
        ficha.getByLabel("Buscar ubicación de envío").or(ficha.getByText(/Gesti[oó]n/).first()),
      ).toBeVisible();
    });

    await test.step("cerrar la ficha", async () => {
      await ficha.getByRole("button", { name: "Cerrar panel" }).click();
      await expect(fichaMovil(pagina)).toBeHidden();
    });
  });

  test("6. Cerrar sesion", async () => {
    await test.step("cerrar sesion", async () => {
      // Se usa la pagina de salida de NextAuth (/api/auth/signout) y no el menu del usuario:
      // en el celular, dentro de /cliente/chats, el menu con "Cerrar sesion" no siempre esta a la vista.
      // FRAGIL: el boton de esa pagina lo pone NextAuth en ingles ("Sign out").
      await pagina.goto("/api/auth/signout");
      await pagina.getByRole("button", { name: /sign out/i }).click();
      await pagina.waitForURL((url) => !url.pathname.startsWith("/api/auth/signout"));
    });

    await test.step("confirmar que ya no hay sesion", async () => {
      await pagina.goto("/cliente/chats");
      await expect(pagina).toHaveURL(/\/login/);
    });
  });
});

// Filas de la bandeja: son <a> con ?chatKey= (conversation-list.tsx). Selector por href porque la
// fila no tiene rol ni nombre propio estable (el nombre es el del cliente).
function filasDeChats(pagina: Page): Locator {
  return pagina.locator('a[href*="/cliente/chats?chatKey="]:visible');
}

// FRAGIL: aria-label del avatar del encabezado del chat (chat-conversation-panel.tsx).
function botonFicha(pagina: Page): Locator {
  return pagina.getByRole("button", { name: /detalles del contacto/ }).first();
}

function fichaMovil(pagina: Page): Locator {
  return pagina.getByRole("dialog", { name: "Contacto" });
}
