import fs from "node:fs";
import path from "node:path";
import type { FullResult, Reporter, TestCase, TestResult, TestStep } from "@playwright/test/reporter";

type Paso = {
  prueba: string;
  nombre: string;
  ms: number;
  ok: boolean;
  intento: number;
  error?: string;
};

type Prueba = {
  nombre: string;
  estado: TestResult["status"];
  ms: number;
  intento: number;
  motivoSkip?: string;
};

/**
 * Escribe e2e-results/tiempos.json con el tiempo de cada test.step() y de cada prueba.
 * Formato: { fecha, commit, baseURL, estado, pruebas: [...], pasos: [...] }.
 */
export default class TiemposReporter implements Reporter {
  private readonly archivo: string;
  private readonly pasos: Paso[] = [];
  private readonly pruebas: Prueba[] = [];
  private readonly inicio = new Date();

  constructor(opciones: { archivo?: string } = {}) {
    this.archivo = opciones.archivo ?? path.resolve(process.cwd(), "e2e-results", "tiempos.json");
  }

  onStepEnd(test: TestCase, result: TestResult, step: TestStep) {
    if (step.category !== "test.step") return;
    this.pasos.push({
      prueba: test.title,
      nombre: step.title,
      ms: Math.round(step.duration),
      ok: !step.error,
      intento: result.retry,
      ...(step.error ? { error: limpiar(step.error.message) } : {}),
    });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const skip = result.annotations.find((a) => a.type === "skip") ?? test.annotations.find((a) => a.type === "skip");
    this.pruebas.push({
      nombre: test.title,
      estado: result.status,
      ms: Math.round(result.duration),
      intento: result.retry,
      ...(result.status === "skipped" && skip?.description ? { motivoSkip: skip.description } : {}),
    });
  }

  async onEnd(result: FullResult) {
    const salida = {
      fecha: this.inicio.toISOString(),
      commit: process.env.GITHUB_SHA ?? null,
      baseURL: process.env.E2E_BASE_URL || "https://app.aizenbot.com",
      estado: result.status,
      msTotal: Math.round(result.duration),
      pruebas: this.pruebas,
      pasos: this.pasos,
    };
    fs.mkdirSync(path.dirname(this.archivo), { recursive: true });
    fs.writeFileSync(this.archivo, JSON.stringify(salida, null, 2) + "\n", "utf8");
  }

  printsToStdio() {
    return false;
  }
}

// Sin codigos de color y corto: el JSON lo lee una persona o un revisor automatico.
function limpiar(mensaje: string | undefined) {
  return (mensaje ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n").slice(0, 3).join(" ").slice(0, 400);
}
