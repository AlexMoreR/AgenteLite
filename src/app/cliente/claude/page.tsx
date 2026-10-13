import { redirect } from "next/navigation";

/* Claude ahora vive como pestaña de Negocio. Esta ruta queda para no romper enlaces viejos. */
export default function ClienteClaudeRedirectPage() {
  redirect("/cliente/negocio/claude");
}
