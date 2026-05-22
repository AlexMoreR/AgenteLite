import type { CrmData, CrmRecord } from "../types";
import { groupCrmRecordsByStage, sortCrmRecords } from "../domain/crm-config";

type GetCrmDataInput = {
  userId: string;
};

function buildMockRecords(): CrmRecord[] {
  return [
    {
      id: "crm-001",
      number: "CRM-001",
      name: "Andrea Mendez",
      date: "2026-05-21T10:20:00.000Z",
      tags: [
        { label: "WhatsApp", color: "#0ea5e9" },
        { label: "Alta prioridad", color: "#7c3aed" },
      ],
      detail: "Pidio cotizacion para paquete premium y espera respuesta con propuesta formal.",
      status: "CALIFICADO",
    },
    {
      id: "crm-002",
      number: "CRM-002",
      name: "Carlos Herrera",
      date: "2026-05-20T16:45:00.000Z",
      tags: [
        { label: "Instagram", color: "#db2777" },
        { label: "Seguimiento", color: "#f97316" },
      ],
      detail: "Comparo precios, envio sus datos y quedo pendiente de la oferta final.",
      status: "PROPUESTA",
    },
    {
      id: "crm-003",
      number: "CRM-003",
      name: "Sofia Castillo",
      date: "2026-05-20T09:12:00.000Z",
      tags: [
        { label: "Nuevo lead", color: "#2563eb" },
        { label: "Meta Ads", color: "#14b8a6" },
      ],
      detail: "Llego desde una campana y quiere entender cual es la mejor opcion antes de agendar.",
      status: "NUEVO",
    },
    {
      id: "crm-004",
      number: "CRM-004",
      name: "Javier Rojas",
      date: "2026-05-19T14:02:00.000Z",
      tags: [
        { label: "B2B", color: "#6366f1" },
        { label: "Alto valor", color: "#8b5cf6" },
      ],
      detail: "Ya reviso la propuesta y entro a negociacion de alcance y tiempos de entrega.",
      status: "NEGOCIACION",
    },
    {
      id: "crm-005",
      number: "CRM-005",
      name: "Valentina Ortiz",
      date: "2026-05-18T18:30:00.000Z",
      tags: [
        { label: "Referido", color: "#10b981" },
        { label: "Cierre rapido", color: "#059669" },
      ],
      detail: "Confirmo compra y solo falta documentar el siguiente paso operativo.",
      status: "GANADO",
    },
    {
      id: "crm-006",
      number: "CRM-006",
      name: "Miguel Torres",
      date: "2026-05-18T11:07:00.000Z",
      tags: [
        { label: "Frio", color: "#94a3b8" },
        { label: "Sin respuesta", color: "#64748b" },
      ],
      detail: "No dio seguimiento despues de la primera llamada y se cerro por ahora.",
      status: "PERDIDO",
    },
    {
      id: "crm-007",
      number: "CRM-007",
      name: "Paula Restrepo",
      date: "2026-05-17T13:55:00.000Z",
      tags: [
        { label: "WhatsApp", color: "#0ea5e9" },
        { label: "Prioridad media", color: "#eab308" },
      ],
      detail: "Dejo datos y pidio que se le explique la oferta con mas claridad.",
      status: "NUEVO",
    },
    {
      id: "crm-008",
      number: "CRM-008",
      name: "Laura Vega",
      date: "2026-05-16T15:28:00.000Z",
      tags: [
        { label: "Propuesta enviada", color: "#8b5cf6" },
        { label: "Web", color: "#6366f1" },
      ],
      detail: "Ya tiene la propuesta y espera validacion interna para avanzar al cierre.",
      status: "PROPUESTA",
    },
  ];
}

export async function getCrmData({ userId }: GetCrmDataInput): Promise<CrmData> {
  void userId;

  const records = sortCrmRecords(buildMockRecords());
  const columns = groupCrmRecordsByStage(records);
  const active = records.filter((record) => record.status !== "GANADO" && record.status !== "PERDIDO").length;
  const won = records.filter((record) => record.status === "GANADO").length;
  const lost = records.filter((record) => record.status === "PERDIDO").length;

  return {
    workspaceName: "CRM comercial",
    records,
    columns,
    stats: {
      total: records.length,
      active,
      won,
      lost,
    },
    generatedAt: new Date().toISOString(),
  };
}
