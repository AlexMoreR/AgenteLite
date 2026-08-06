import { CrmLoadingState } from "@/features/crm/components/CrmLoadingState";

/**
 * Lo que se ve mientras la pantalla se arma en el servidor.
 *
 * Sin esto la app se queda EN BLANCO entre 0,3 y 0,9 segundos en escritorio —y varios segundos en
 * el celular con datos—, sin ninguna señal de que este pasando algo. Medido: era asi en todas las
 * secciones salvo CRM, que era la unica que tenia esta pantalla.
 */
export default function Cargando() {
  return (
    <CrmLoadingState
      titulo="Cargando tu equipo"
      detalle="Estamos trayendo los usuarios y sus permisos."
    />
  );
}
