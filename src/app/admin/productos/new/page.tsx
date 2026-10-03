import { redirect } from "next/navigation";

/**
 * Los productos ya no se crean en el CRM (Alex, 03-10-2026): se crean en Gestión, la fuente de
 * verdad del catálogo, y llegan al sincronizar. La pantalla de Productos tiene el botón "Crear
 * producto en Gestión"; esta dirección vieja lleva ahí.
 */
export default function AdminNuevoProductoPage() {
  redirect("/admin/productos");
}
