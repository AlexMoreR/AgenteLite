import { prisma } from "@/lib/prisma";

/**
 * El playbook de ventas de un producto.
 *
 * El embudo del diagrama dice el ORDEN de los pasos. El playbook dice COMO se vende: con que
 * abrir, que no prometer nunca, y que contestar a cada objecion. Son cosas distintas y por eso
 * viven separadas: el embudo se toca poco, el playbook se corrige cada vez que se pierde una
 * venta y hay que poder cambiarlo sin volver a publicar el agente.
 */

/**
 * "BENEFICIO" guarda un par caracteristica → beneficio y reusa la misma tabla de reglas: `kind`
 * es texto justamente para poder sumar un tipo sin migrar la base. La caracteristica va en
 * `trigger` y el beneficio en `text`, igual que la objecion guarda "lo que dice" y "que contestar".
 */
export const PLAYBOOK_RULE_KINDS = ["DECIR", "NO_DECIR", "OBJECION", "BENEFICIO"] as const;
export type PlaybookRuleKind = (typeof PLAYBOOK_RULE_KINDS)[number];

export function isPlaybookRuleKind(value: string): value is PlaybookRuleKind {
  return (PLAYBOOK_RULE_KINDS as readonly string[]).includes(value);
}

export type ProductPlaybookRuleItem = {
  id: string;
  kind: PlaybookRuleKind;
  trigger: string | null;
  text: string;
  isActive: boolean;
  source: string;
  createdAt: string;
};

export type ProductPlaybookData = {
  productId: string;
  idealCustomer: string;
  customerPain: string;
  pitch: string;
  rules: ProductPlaybookRuleItem[];
};

export async function getProductPlaybook(input: {
  workspaceId: string;
  productId: string;
}): Promise<ProductPlaybookData> {
  const playbook = await prisma.productPlaybook.findUnique({
    where: {
      workspaceId_productId: { workspaceId: input.workspaceId, productId: input.productId },
    },
    select: {
      idealCustomer: true,
      customerPain: true,
      pitch: true,
      rules: {
        where: { isActive: true },
        orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          kind: true,
          trigger: true,
          text: true,
          isActive: true,
          source: true,
          createdAt: true,
        },
      },
    },
  });

  return {
    productId: input.productId,
    idealCustomer: playbook?.idealCustomer?.trim() || "",
    customerPain: playbook?.customerPain?.trim() || "",
    pitch: playbook?.pitch?.trim() || "",
    rules: (playbook?.rules ?? [])
      .filter((rule) => isPlaybookRuleKind(rule.kind))
      .map((rule) => ({
        id: rule.id,
        kind: rule.kind as PlaybookRuleKind,
        trigger: rule.trigger?.trim() || null,
        text: rule.text,
        isActive: rule.isActive,
        source: rule.source,
        createdAt: rule.createdAt.toISOString(),
      })),
  };
}

/**
 * El playbook escrito para que lo lea la IA, o cadena vacia si el producto no tiene nada.
 *
 * Se arma en el momento de responder —no al publicar el agente— para que una regla agregada hoy
 * a las 3 de la tarde aplique en la conversacion de las 3 y un minuto. Ese es todo el punto: un
 * sistema de ventas que se corrige el mismo dia, no en el proximo despliegue.
 */
export function buildProductPlaybookPrompt(
  playbook: ProductPlaybookData,
  productName: string,
): string {
  const decir = playbook.rules.filter((rule) => rule.kind === "DECIR");
  const noDecir = playbook.rules.filter((rule) => rule.kind === "NO_DECIR");
  const objeciones = playbook.rules.filter((rule) => rule.kind === "OBJECION");
  const beneficios = playbook.rules.filter((rule) => rule.kind === "BENEFICIO");

  if (
    !playbook.idealCustomer &&
    !playbook.customerPain &&
    beneficios.length === 0 &&
    !playbook.pitch &&
    decir.length === 0 &&
    noDecir.length === 0 &&
    objeciones.length === 0
  ) {
    return "";
  }

  const bloques: string[] = [`PLAYBOOK DE VENTAS DE "${productName}"`];

  if (playbook.idealCustomer) {
    // Primero a quien le hablamos: cambia el tono de todo lo que sigue.
    bloques.push(`A quien le sirve este producto:\n${playbook.idealCustomer}`);
  }
  if (playbook.customerPain) {
    bloques.push(`Que le duele a ese cliente:\n${playbook.customerPain}`);
  }
  if (beneficios.length > 0) {
    // Caracteristica → beneficio, y nunca al reves: sin el "para que le sirve", la IA recita
    // ficha tecnica y el cliente no ve por que le conviene.
    bloques.push(
      `Que tiene y para que le sirve al cliente (nombra SIEMPRE el beneficio, no solo la ` +
        `caracteristica):\n${beneficios
          .map((rule) => `- ${rule.trigger ?? ""} → ${rule.text}`)
          .join("\n")}`,
    );
  }
  if (playbook.pitch) {
    bloques.push(`Como vender este producto:\n${playbook.pitch}`);
  }
  if (decir.length > 0) {
    bloques.push(`Hace SIEMPRE esto:\n${decir.map((rule) => `- ${rule.text}`).join("\n")}`);
  }
  if (noDecir.length > 0) {
    // Las prohibiciones van al final del bloque de reglas y en mayusculas porque son las que mas
    // caro salen: prometer un descuento o un tiempo de entrega que no existe.
    bloques.push(`NUNCA hagas esto:\n${noDecir.map((rule) => `- ${rule.text}`).join("\n")}`);
  }
  if (objeciones.length > 0) {
    bloques.push(
      `Si el cliente dice algo asi, responde asi:\n${objeciones
        .map((rule) => `- Si dice "${rule.trigger ?? "algo parecido"}" → ${rule.text}`)
        .join("\n")}`,
    );
  }

  bloques.push(
    "Este playbook manda sobre las instrucciones generales del embudo cuando se contradigan: " +
      "es lo aprendido vendiendo este producto.",
  );

  return bloques.join("\n\n");
}
