import { adminModuleDefinitions, type AdminModuleKey } from "@/lib/admin-modules";

export const clientAssignableModuleKeys = [
  "chats",
  "contacts",
  "crm",
  "flows",
  "seguimientos",
  "marketing_ia",
  "finanzas",
  "connection",
  "agents",
  "agents_v2",
  "products_v2",
  "client_official_api",
] as const satisfies readonly AdminModuleKey[];

export type ClientAssignableModuleKey = (typeof clientAssignableModuleKeys)[number];

export const defaultClientEmployeeModuleKeys = [
  "chats",
  "contacts",
  "crm",
] as const satisfies readonly ClientAssignableModuleKey[];

const clientAssignableModuleKeySet = new Set<AdminModuleKey>(clientAssignableModuleKeys);

export function isClientAssignableModuleKey(value: string): value is ClientAssignableModuleKey {
  return clientAssignableModuleKeySet.has(value as AdminModuleKey);
}

export function sanitizeClientModuleAccess(value: unknown): ClientAssignableModuleKey[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value.filter(
        (item): item is ClientAssignableModuleKey =>
          typeof item === "string" && isClientAssignableModuleKey(item),
      ),
    ),
  );
}

export const clientAssignableModuleDefinitions = clientAssignableModuleKeys.map((key) => {
  const definition = adminModuleDefinitions.find((item) => item.key === key);
  return {
    key,
    label: definition?.label ?? key,
    description: definition?.description ?? "",
  };
});
