import { devices } from "@playwright/test";

/**
 * Ajustes compartidos por la config y las pruebas E2E.
 * Las credenciales SOLO llegan por variables de entorno (secretos de GitHub en el workflow).
 */
export const BASE_URL = process.env.E2E_BASE_URL || "https://app.aizenbot.com";
export const E2E_EMAIL = process.env.E2E_EMAIL ?? "";
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "";
export const FALTAN_SECRETOS = !E2E_EMAIL || !E2E_PASSWORD;

/** Asesora en el celular: Chrome Android con pantalla tactil. */
export const CONTEXTO_MOVIL = {
  ...devices["Pixel 7"],
  baseURL: BASE_URL,
  locale: "es-CO",
  timezoneId: "America/Bogota",
};
