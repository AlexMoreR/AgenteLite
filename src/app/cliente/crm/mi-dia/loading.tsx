import { CrmLoadingState } from "@/features/crm/components/CrmLoadingState";

/**
 * "Mi día" es la primera pantalla que ve TODO el mundo al entrar a la app, asi que su mensaje
 * de espera es el que mas se lee en todo el CRM. Va con texto propio: dice lo que la asesora
 * esta esperando saber, no un generico.
 */
export default function MiDiaLoading() {
  return (
    <CrmLoadingState
      titulo="Armando tu día"
      detalle="Buscando a quién contactar primero, de más urgente a menos."
    />
  );
}
