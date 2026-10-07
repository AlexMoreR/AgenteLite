import path from "node:path";
import { defineConfig } from "@playwright/test";
import { CONTEXTO_MOVIL } from "./ajustes";

// Todo lo que generan las pruebas queda en e2e-results/ (en .gitignore).
const RESULTADOS = path.resolve(__dirname, "..", "e2e-results");

export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.ts$/,
  outputDir: path.join(RESULTADOS, "artefactos"),
  // Una sola asesora, una prueba a la vez: carga minima sobre produccion.
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(RESULTADOS, "reporte-html"), open: "never" }],
    ["./tiempos-reporter.ts", { archivo: path.join(RESULTADOS, "tiempos.json") }],
  ],
  use: {
    ...CONTEXTO_MOVIL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Capturas y traza solo cuando algo falla.
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "movil",
      use: { ...CONTEXTO_MOVIL },
    },
  ],
});
