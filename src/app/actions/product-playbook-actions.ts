"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import {
  isPlaybookRuleKind,
  PRODUCT_FUNNEL_STAGES,
  type PlaybookRuleKind,
} from "@/lib/product-playbook";

/**
 * Guardar el playbook de ventas de un producto.
 *
 * Cada regla se guarda por separado (y no como un texto largo) para poder saber CUANDO se agrego
 * y de donde salio. Eso es lo que despues permite mirar una venta perdida y dejar la leccion
 * escrita con fecha, en vez de contarla en una reunion y que se pierda.
 */

async function getAccess() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  await requireClientWorkspaceAccess("products_v2");
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  return membership?.workspace.id ?? null;
}

async function ensurePlaybook(workspaceId: string, productId: string) {
  const existente = await prisma.productPlaybook.findUnique({
    where: { workspaceId_productId: { workspaceId, productId } },
    select: { id: true },
  });
  if (existente) {
    return existente.id;
  }
  const creado = await prisma.productPlaybook.create({
    data: { workspaceId, productId },
    select: { id: true },
  });
  return creado.id;
}

export async function saveProductPitchAction(input: {
  productId: string;
  idealCustomer?: string;
  customerPain?: string;
}): Promise<{ ok?: true; error?: string }> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  const productId = input.productId?.trim();
  if (!productId) {
    return { error: "Datos invalidos" };
  }

  const producto = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!producto) {
    return { error: "Producto no encontrado" };
  }

  const playbookId = await ensurePlaybook(workspaceId, productId);
  await prisma.productPlaybook.update({
    where: { id: playbookId },
    data: {
      ...(input.idealCustomer === undefined
        ? {}
        : { idealCustomer: input.idealCustomer.trim() || null }),
      ...(input.customerPain === undefined
        ? {}
        : { customerPain: input.customerPain.trim() || null }),
    },
  });

  revalidatePath("/cliente/productos-v2");
  return { ok: true };
}

/**
 * Guardar las cinco etapas del embudo del producto de una sola vez.
 *
 * Van juntas y no una por una porque el embudo se lee y se corrige como un recorrido: cambiar el
 * cierre sin mirar lo que promete la presentacion es como se rompen los embudos.
 */
export async function saveProductFunnelAction(input: {
  productId: string;
  stages: Array<{
    stage: string;
    goal: string;
    script: string;
    followUps?: Array<{
      timeType?: string | null;
      timeValue?: number | null;
      content?: string | null;
      cancelOnActivity?: boolean | null;
    }>;
  }>;
}): Promise<{ ok?: true; error?: string }> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  const productId = input.productId?.trim();
  if (!productId) {
    return { error: "Datos invalidos" };
  }

  const producto = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!producto) {
    return { error: "Producto no encontrado" };
  }

  const conocidas = new Map(PRODUCT_FUNNEL_STAGES.map((etapa, indice) => [etapa.stage as string, indice]));
  const playbookId = await ensurePlaybook(workspaceId, productId);

  for (const etapa of Array.isArray(input.stages) ? input.stages : []) {
    const orden = conocidas.get(etapa.stage);
    if (orden === undefined) {
      continue;
    }
    const goal = etapa.goal?.trim() || null;
    const script = etapa.script?.trim() || null;

    const guardada = await prisma.productFunnelStage.upsert({
      where: { playbookId_stage: { playbookId, stage: etapa.stage } },
      // stuckAfterMessages queda en null: la red de seguridad se saco (el agente ya escala solo
      // cuando no sabe algo, y contar mensajes se disparaba en conversaciones sanas).
      create: { playbookId, stage: etapa.stage, goal, script, sortOrder: orden, stuckAfterMessages: null },
      update: { goal, script, sortOrder: orden, stuckAfterMessages: null },
      select: { id: true },
    });

    /**
     * Los seguimientos se reemplazan enteros, no se van fusionando uno por uno.
     *
     * Es una lista corta que se edita como un bloque —se agrega uno, se borra otro, se reordenan—
     * y fusionar por id obligaria a arrastrar ids de filas borradas por la pantalla. Reemplazar
     * deja el estado guardado igual a lo que se ve, que es la unica forma de que nadie descubra
     * un seguimiento fantasma mandandole un WhatsApp a un cliente.
     *
     * Un seguimiento sin texto no se guarda: agendaria un envio vacio.
     */
    const seguimientos = (Array.isArray(etapa.followUps) ? etapa.followUps : [])
      .map((seguimiento) => {
        const valor = Number(seguimiento.timeValue);
        const unidad =
          seguimiento.timeType === "MINUTES" || seguimiento.timeType === "HOURS"
            ? seguimiento.timeType
            : "DAYS";
        return {
          timeType: unidad as "MINUTES" | "HOURS" | "DAYS",
          timeValue: Number.isInteger(valor) && valor > 0 && valor <= 999 ? valor : 0,
          content: seguimiento.content?.trim() || "",
          cancelOnActivity: seguimiento.cancelOnActivity !== false,
        };
      })
      .filter((seguimiento) => seguimiento.timeValue > 0 && seguimiento.content.length > 0);

    await prisma.productStageFollowUp.deleteMany({ where: { stageId: guardada.id } });
    if (seguimientos.length > 0) {
      await prisma.productStageFollowUp.createMany({
        data: seguimientos.map((seguimiento, indice) => ({
          stageId: guardada.id,
          sortOrder: indice,
          timeType: seguimiento.timeType,
          timeValue: seguimiento.timeValue,
          messageType: "TEXT" as const,
          content: seguimiento.content,
          cancelOnActivity: seguimiento.cancelOnActivity,
        })),
      });
    }
  }

  revalidatePath("/cliente/productos-v2");
  return { ok: true };
}

/**
 * Guardar como se reconoce un producto: palabras del cliente y anuncios de origen.
 *
 * Es lo que permite mirar las conversaciones que atendio una persona. Cuando la IA esta en pausa
 * el agente nunca corre, y sin esta regla esas conversaciones no pertenecen a ningun producto.
 */
export async function saveProductMatchAction(input: {
  productId: string;
  keywords: string[];
  adTitles: string[];
}): Promise<{ ok?: true; error?: string }> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  const productId = input.productId?.trim();
  if (!productId) {
    return { error: "Datos invalidos" };
  }

  const producto = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!producto) {
    return { error: "Producto no encontrado" };
  }

  const limpiar = (valores: string[]) =>
    Array.from(
      new Set(
        (Array.isArray(valores) ? valores : [])
          .map((valor) => (typeof valor === "string" ? valor.trim() : ""))
          // Una palabra de una o dos letras engancha cualquier cosa: ya nos paso que "si" matcheara
          // "silla" y pisara el producto de una conversacion entera.
          .filter((valor) => valor.length >= 3),
      ),
    ).slice(0, 20);

  const playbookId = await ensurePlaybook(workspaceId, productId);
  await prisma.productPlaybook.update({
    where: { id: playbookId },
    data: { matchKeywords: limpiar(input.keywords), matchAdTitles: limpiar(input.adTitles) },
  });

  revalidatePath("/cliente/productos-v2");
  return { ok: true };
}

export async function addProductPlaybookRuleAction(input: {
  productId: string;
  kind: string;
  trigger?: string;
  text: string;
  source?: string;
  originConversationId?: string;
}): Promise<{ ok?: true; error?: string; ruleId?: string }> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  const productId = input.productId?.trim();
  const text = input.text?.trim();
  if (!productId || !text) {
    return { error: "Escribe la regla" };
  }
  if (!isPlaybookRuleKind(input.kind)) {
    return { error: "Tipo de regla invalido" };
  }
  const kind: PlaybookRuleKind = input.kind;
  const trigger = input.trigger?.trim() || "";
  if (kind === "OBJECION" && !trigger) {
    return { error: "Escribe que dice el cliente" };
  }
  if (kind === "BENEFICIO" && !trigger) {
    return { error: "Escribe la caracteristica" };
  }

  const producto = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!producto) {
    return { error: "Producto no encontrado" };
  }

  const playbookId = await ensurePlaybook(workspaceId, productId);
  const ultimo = await prisma.productPlaybookRule.findFirst({
    where: { playbookId, kind },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const regla = await prisma.productPlaybookRule.create({
    data: {
      playbookId,
      kind,
      trigger: kind === "OBJECION" || kind === "BENEFICIO" ? trigger : null,
      text,
      sortOrder: (ultimo?.sortOrder ?? 0) + 1,
      source: input.source?.trim() || "manual",
      originConversationId: input.originConversationId?.trim() || null,
    },
    select: { id: true },
  });

  revalidatePath("/cliente/productos-v2");
  return { ok: true, ruleId: regla.id };
}

export async function deleteProductPlaybookRuleAction(input: {
  ruleId: string;
}): Promise<{ ok?: true; error?: string }> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  const ruleId = input.ruleId?.trim();
  if (!ruleId) {
    return { error: "Datos invalidos" };
  }

  // La regla se busca POR SU WORKSPACE: sin esto, un id prestado borraria una regla de otro
  // negocio.
  const regla = await prisma.productPlaybookRule.findFirst({
    where: { id: ruleId, playbook: { workspaceId } },
    select: { id: true },
  });
  if (!regla) {
    return { error: "Regla no encontrada" };
  }

  await prisma.productPlaybookRule.delete({ where: { id: regla.id } });

  revalidatePath("/cliente/productos-v2");
  return { ok: true };
}

/**
 * Editar lo basico del producto desde Producto V2: nombre, descripcion y precio.
 *
 * Existe aparte de la accion del panel de administrador —que pide codigo, costo, margen,
 * categoria, proveedor e imagenes— porque desde aca se corrige lo que afecta a la VENTA, y pedir
 * doce campos para cambiar una descripcion hace que nadie la cambie.
 *
 * El "tipo" (Vende / Catalogo) NO es un campo: sale de si hay precio. Por eso pasar a catalogo se
 * manda como precio nulo, y el precio se guarda en 0.
 */
export async function saveProductBasicsAction(input: {
  productId: string;
  name: string;
  description: string;
  /** null = producto de catalogo (sin precio). */
  price: number | null;
}): Promise<{ ok?: true; error?: string }> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  const productId = input.productId?.trim();
  const name = input.name?.trim();
  if (!productId || !name) {
    return { error: "El nombre no puede quedar vacío" };
  }

  const producto = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!producto) {
    return { error: "Producto no encontrado" };
  }

  const precio = input.price === null ? 0 : Number(input.price);
  if (!Number.isFinite(precio) || precio < 0) {
    return { error: "El precio no es válido" };
  }

  await prisma.product.update({
    where: { id: productId },
    data: {
      name,
      description: input.description?.trim() || null,
      price: precio,
    },
  });

  revalidatePath("/cliente/productos-v2");
  return { ok: true };
}
