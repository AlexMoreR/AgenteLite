import { notFound } from "next/navigation";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { EmbudoDiagramaCanvas } from "@/features/productos-v2/components/EmbudoDiagramaCanvas";
import { getProductLeadProgress } from "@/features/productos-v2/services/getProductLeadProgress";
import { getProductMatchRule } from "@/features/productos-v2/services/productConversationFilter";

/**
 * El embudo de un producto, en pantalla completa.
 *
 * Va en su propia pagina y no en una pestaña porque un lienzo necesita TODA la pantalla: metido
 * dentro de la ficha del producto, las cinco etapas entraban en una franja donde no se lee ni se
 * arrastra nada.
 *
 * Las etapas son fijas, asi que la pagina no crea ni borra nodos: solo carga lo que hay escrito en
 * cada una y lo deja editar.
 */
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EmbudoDiagramaPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("products_v2");

  const params = await searchParams;
  const productId = typeof params.producto === "string" ? params.producto.trim() : "";
  if (!productId) {
    notFound();
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true },
  });
  if (!product) {
    notFound();
  }

  const playbook = await prisma.productPlaybook.findFirst({
    where: { productId },
    select: {
      stages: {
        select: { stage: true, goal: true, script: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  /*
    Cuantos se caen en cada etapa.

    Es el mismo dato que muestra la lista, y es lo que hace que esto sirva para algo mas que ver el
    guion bonito: sin el numero, el dibujo no dice donde se corta la venta.
  */
  const avance = await getProductMatchRule({ workspaceId: access.workspaceId, productId })
    .then((rule) => getProductLeadProgress({ workspaceId: access.workspaceId, rule }))
    .catch(() => null);
  const perdidosEnEtapa: Record<string, { valor: number; pct: number } | undefined> = {};
  if (avance && avance.total > 0) {
    const pct = (valor: number) => Math.round((valor / avance.total) * 100);
    perdidosEnEtapa.PRESENTACION = { valor: avance.murioPrimero, pct: pct(avance.murioPrimero) };
    perdidosEnEtapa.IDENTIFICACION = { valor: avance.mandoDos, pct: pct(avance.mandoDos) };
    perdidosEnEtapa.PRODUCTO = { valor: avance.converso, pct: pct(avance.converso) };
    perdidosEnEtapa.OBJECIONES = { valor: avance.larga, pct: pct(avance.larga) };
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <EmbudoDiagramaCanvas
        productId={product.id}
        productName={product.name}
        etapasIniciales={(playbook?.stages ?? []).map((etapa) => ({
          stage: etapa.stage,
          goal: etapa.goal ?? "",
          script: etapa.script ?? "",
        }))}
        perdidosEnEtapa={perdidosEnEtapa}
        volverA={`/cliente/productos-v2?producto=${encodeURIComponent(product.id)}`}
      />
    </section>
  );
}
