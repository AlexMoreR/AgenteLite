import { prisma } from "@/lib/prisma";

import { PRODUCT_FUNNEL_STAGES } from "@/lib/product-funnel-stages";

/*
  Las etapas que un producto NO usa.

  Las cinco etapas siguen siendo las mismas para todos —es lo que deja comparar un producto con
  otro— pero no todas las ventas las recorren: Alex pidio poder quitar "Identificacion" del Combo
  Camillas (20-sep-2026), porque ahi el cliente ya llega sabiendo que quiere y preguntar de nuevo
  le hace perder el hilo.

  Quitar una etapa NO inventa una etapa nueva: solo se saltea. Y se puede volver a usar cuando se
  quiera, por eso queda anotada en vez de borrarse y olvidarse.

  Vive en AppSetting, una fila por producto, para no migrar la base de produccion.
*/

const PREFIJO = "producto:embudo:quitadas:";

const CONOCIDAS = new Set<string>(PRODUCT_FUNNEL_STAGES.map((etapa) => etapa.stage));

function clave(productId: string) {
  return `${PREFIJO}${productId}`;
}

export async function leerEtapasQuitadas(productId: string): Promise<string[]> {
  const fila = await prisma.appSetting.findUnique({ where: { key: clave(productId) } });
  if (!fila?.value) {
    return [];
  }
  try {
    const guardado = JSON.parse(fila.value) as unknown;
    return Array.isArray(guardado) ? guardado.filter((item): item is string => CONOCIDAS.has(item as string)) : [];
  } catch {
    return [];
  }
}

export async function guardarEtapasQuitadas(productId: string, quitadas: string[]): Promise<void> {
  // La ultima etapa no se puede quitar junto con todas las demas: un embudo sin ninguna etapa deja
  // al agente sin nada que decir.
  const limpias = Array.from(new Set(quitadas.filter((etapa) => CONOCIDAS.has(etapa)))).slice(
    0,
    PRODUCT_FUNNEL_STAGES.length - 1,
  );
  const value = JSON.stringify(limpias);
  await prisma.appSetting.upsert({
    where: { key: clave(productId) },
    create: { key: clave(productId), value },
    update: { value },
  });
}
