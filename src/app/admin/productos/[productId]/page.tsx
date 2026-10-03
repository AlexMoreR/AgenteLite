import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ productId: string }>;
};

/**
 * La ficha de un producto vive ahora en el panel de la pantalla de Productos (03-10-2026): lo que
 * viene de Gestión se ve con candado y lo que es del CRM (la descripción de venta y el embudo) se
 * edita ahí. Esta dirección vieja lleva a la lista.
 */
export default async function AdminProductoDetallePage({ params }: PageProps) {
  await params;
  redirect("/admin/productos");
}
