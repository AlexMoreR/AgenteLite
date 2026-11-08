import { expect, test, type BrowserContext, type Locator, type Page, type Response } from "@playwright/test";
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
    /*
      Peso de las fotos de perfil de la primera pagina (07-11-2026). Se escucha ANTES del goto y se
      suman los bytes reales del cuerpo. Cuentan: las miniaturas (/_next/image con w=96), las
      originales de /uploads/ (si alguna miniatura falla) y las de WhatsApp (pps.whatsapp.net).
    */
    const pesos: Promise<{ bytes: number; deWhatsApp: boolean }>[] = [];
    const alResponder = (respuesta: Response) => {
      const url = new URL(respuesta.url());
      const deWhatsApp = url.hostname === "pps.whatsapp.net";
      const miniatura = url.pathname === "/_next/image" && url.searchParams.get("w") === "96";
      const original = url.pathname.startsWith("/uploads/") && respuesta.request().resourceType() === "image";
      if (!deWhatsApp && !miniatura && !original) return;
      pesos.push(
        respuesta
          .body()
          .then((cuerpo) => ({ bytes: cuerpo.length, deWhatsApp }))
          .catch(() => ({ bytes: 0, deWhatsApp })),
      );
    };
    pagina.on("response", alResponder);

    await test.step("abrir /cliente/chats", async () => {
      await pagina.goto("/cliente/chats");
      // FRAGIL: el boton "Nueva lista" (appsidebar.tsx) es lo primero fijo de la bandeja.
      await expect(pagina.getByRole("button", { name: "Nueva lista" })).toBeVisible();
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

    await test.step("las fotos de la primera pagina pesan menos de 150 KB", async () => {
      // Sin deslizar la lista: solo las fotos de las filas que se ven al entrar.
      await pagina.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      pagina.off("response", alResponder);
      const fotos = await Promise.all(pesos);
      const total = fotos.reduce((suma, foto) => suma + foto.bytes, 0);
      const deWhatsApp = fotos.filter((foto) => foto.deWhatsApp);
      const bytesDeWhatsApp = deWhatsApp.reduce((suma, foto) => suma + foto.bytes, 0);
      const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
      const resumen =
        `${fotos.length} fotos, ${kb(total)} en total; ` +
        `${deWhatsApp.length} con direccion de WhatsApp (${kb(bytesDeWhatsApp)})`;
      const limite = 150 * 1024;
      // Si se pasa solo por las de WhatsApp, se dice: esas no se achican y arreglarlas es otra tarjeta.
      const soloPorWhatsApp = total >= limite && total - bytesDeWhatsApp < limite;
      test.info().annotations.push({
        type: "peso de las fotos",
        description: soloPorWhatsApp
          ? `${resumen}. Se pasa de 150 KB solo por las ${deWhatsApp.length} fotos de WhatsApp (${kb(bytesDeWhatsApp)})`
          : resumen,
      });
      expect(
        total,
        soloPorWhatsApp
          ? `Las fotos pesan ${kb(total)}: se pasa de 150 KB solo por las ${deWhatsApp.length} fotos con direccion de WhatsApp (${kb(bytesDeWhatsApp)}), que no se achican`
          : `Las fotos de la primera pagina pesan ${kb(total)} (${resumen})`,
      ).toBeLessThan(limite);
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

  test("3b. Resolver se ve sin deslizar a 375 y 360 px", async () => {
    test.skip(!chatAbierto, "No hay chat abierto.");
    // Solo se mira: NUNCA se toca Resolver (resolveria el chat de verdad).
    const tamanoOriginal = pagina.viewportSize();
    try {
      for (const ancho of [375, 360]) {
        await test.step(`a ${ancho} px Resolver queda dentro de la pantalla`, async () => {
          await pagina.setViewportSize({ width: ancho, height: tamanoOriginal?.height ?? 740 });
          // FRAGIL: aria-label del boton de la barra (snooze-chat-control / resolve-chat-control).
          // Con ficha es "Resolver o posponer"; sin ficha, "Resolver conversación" o "Reabrir conversación".
          const resolver = pagina
            .getByRole("button", { name: /^(Resolver o posponer|Resolver conversación|Reabrir conversación)$/ })
            .filter({ visible: true })
            .first();
          await expect(resolver).toBeVisible();
          const caja = await resolver.boundingBox();
          expect(caja, "el boton de Resolver no tiene caja").not.toBeNull();
          expect(caja!.x).toBeGreaterThanOrEqual(0);
          expect(caja!.x + caja!.width).toBeLessThanOrEqual(ancho);
        });
      }
    } finally {
      if (tamanoOriginal) await pagina.setViewportSize(tamanoOriginal);
    }
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

  test("5b. Pegar una imagen en la caja de mensaje (sin enviar)", async () => {
    test.skip(!chatAbierto, "No hay chat abierto.");

    // Si la prueba anterior se salto, la ficha puede seguir abierta tapando la caja.
    if (await fichaMovil(pagina).isVisible()) {
      await pagina.getByRole("button", { name: "Cerrar panel" }).click();
      await expect(fichaMovil(pagina)).toBeHidden();
    }
    const caja = pagina.locator('textarea[name="message"]');
    test.skip((await caja.count()) === 0, "El chat no tiene caja de mensaje.");

    // PNG de 1x1; se dispara el evento "paste" como lo hace el celular (en `files`) y el computador (en `items`).
    const pegar = (modo: "files" | "items" | "texto") =>
      caja.evaluate((el, modoPegado) => {
        const bytes = Uint8Array.from(
          atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="),
          (c) => c.charCodeAt(0),
        );
        const datos = new DataTransfer();
        if (modoPegado === "texto") {
          datos.setData("text/plain", "hola");
        } else if (modoPegado === "items") {
          datos.items.add(new File([bytes], "image.png", { type: "image/png" }));
        }
        const evento = new Event("paste", { bubbles: true, cancelable: true }) as Event & {
          clipboardData: DataTransfer;
        };
        if (modoPegado === "files") {
          // Como Android/iPhone: la imagen solo se ve en `files`, `items` llega vacio.
          const archivo = new File([bytes], "", { type: "image/png" });
          Object.defineProperty(evento, "clipboardData", {
            value: { items: [], files: [archivo], getData: () => "" },
          });
        } else {
          Object.defineProperty(evento, "clipboardData", { value: datos });
        }
        return !el.dispatchEvent(evento); // true = la app cancelo el pegado (lo tomo ella)
      }, modo);

    const vistaPrevia = pagina.getByRole("dialog").filter({ hasText: "Enviar archivo" });

    for (const modo of ["files", "items"] as const) {
      await test.step(`pegar imagen en ${modo}: aparece la vista previa`, async () => {
        expect(await pegar(modo)).toBe(true);
        await expect(vistaPrevia).toBeVisible();
        // Se cancela: esta prueba NUNCA envia nada al cliente.
        await pagina.keyboard.press("Escape");
        await expect(vistaPrevia).toBeHidden();
      });
    }

    await test.step("pegar solo texto: no abre vista previa y el pegado sigue normal", async () => {
      expect(await pegar("texto")).toBe(false);
      await expect(vistaPrevia).toBeHidden();
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
