import { redirect } from "next/navigation";

// La entrada del módulo Dirección lleva directo al Supervisor.
export default function DireccionPage() {
  redirect("/cliente/direccion/supervisor");
}
