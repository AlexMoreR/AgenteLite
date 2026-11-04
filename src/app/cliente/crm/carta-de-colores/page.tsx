import type { Metadata } from "next";
import { listarCartaDeColoresAction } from "@/app/actions/carta-de-colores-actions";
import { CartaDeColoresWorkspace } from "@/features/carta-de-colores/components/CartaDeColoresWorkspace";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/*
  Carta de colores (parte 3 de «Carta de colores digital dentro del CRM»).
  La ve todo el que entra al CRM; solo dueño, administrador o supervisora la cambian
  (`puedeEditar`, y la acción lo vuelve a revisar del lado del servidor).
*/
export default async function ClienteCrmCartaDeColoresPage() {
  const { materiales, puedeEditar } = await listarCartaDeColoresAction();

  return <CartaDeColoresWorkspace materiales={materiales} puedeEditar={puedeEditar} />;
}
