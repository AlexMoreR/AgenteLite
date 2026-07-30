import { CrmLoadingState } from "@/features/crm/components/CrmLoadingState";

export default function CrmLoading() {
  return (
    <CrmLoadingState
      titulo="Cargando tu CRM"
      detalle="Estamos trayendo tus leads y sus etapas. Puede tardar unos segundos."
    />
  );
}
