import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const ADMIN_MODULE_ACCESS_SETTING_KEY = "adminModuleAccess";

export const adminModuleDefinitions = [
  {
    key: "config_users",
    label: "Usuarios",
    description: "Gestiona cuentas, roles y accesos.",
    path: "/admin/configuracion/usuarios",
    group: "Configuracion",
  },
  {
    key: "config_business",
    label: "Configuracion negocio",
    description: "Moneda, marca y color principal del sistema.",
    path: "/admin/configuracion/negocio",
    group: "Configuracion",
  },
  {
    key: "config_permissions",
    label: "Control de modulos",
    description: "Define que modulos puede ver y abrir cada usuario.",
    path: "/admin/configuracion/permisos",
    group: "Configuracion",
  },
  {
    key: "config_whatsapp",
    label: "Configuracion WhatsApp",
    description: "Configura Evolution API y parametros globales de WhatsApp.",
    path: "/admin/configuracion/whatsapp",
    group: "Configuracion",
  },
  {
    key: "products",
    label: "Productos",
    description: "Catalogo, creacion y edicion de productos.",
    path: "/admin/productos",
    group: "Catalogo",
  },
  {
    key: "categories",
    label: "Categorias",
    description: "Gestiona categorias del catalogo.",
    path: "/admin/categorias",
    group: "Catalogo",
  },
  {
    key: "suppliers",
    label: "Proveedores",
    description: "Gestiona proveedores del catalogo.",
    path: "/admin/proveedores",
    group: "Catalogo",
  },
  {
    key: "quotes",
    label: "Cotizaciones",
    description: "Crea, edita y consulta cotizaciones.",
    path: "/admin/cotizaciones",
    group: "Comercial",
  },
  {
    key: "client_official_api",
    label: "Api oficial (Cliente)",
    description: "Permite ver y operar el modulo Api oficial en el area cliente.",
    path: "/cliente/api-oficial",
    group: "Cliente",
  },
] as const;

export type AdminModuleKey = (typeof adminModuleDefinitions)[number]["key"];

type RoleModuleAccessMap = Partial<Record<Role, AdminModuleKey[]>>;

const defaultAdminVisibleModules = new Set<AdminModuleKey>([
  "config_users",
  "config_business",
  "config_permissions",
  "config_whatsapp",
]);

async function ensureAppSettingTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AppSetting" (
      "key" TEXT NOT NULL PRIMARY KEY,
      "value" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function getAdminModuleKeySet(): Set<AdminModuleKey> {
  return new Set(adminModuleDefinitions.map((item) => item.key));
}

function sanitizeStoredModules(value: unknown): AdminModuleKey[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const validKeys = getAdminModuleKeySet();
  return value.filter((item): item is AdminModuleKey => typeof item === "string" && validKeys.has(item as AdminModuleKey));
}

function sanitizeRoleModuleAccessMap(value: unknown): RoleModuleAccessMap {
  if (!value || typeof value !== "object") {
    return {};
  }

  const source = value as Record<string, unknown>;
  const hasRoleKeys =
    Object.prototype.hasOwnProperty.call(source, "ADMIN") ||
    Object.prototype.hasOwnProperty.call(source, "EMPLEADO") ||
    Object.prototype.hasOwnProperty.call(source, "CLIENTE");

  if (!hasRoleKeys) {
    return {};
  }

  return {
    ADMIN: sanitizeStoredModules(source.ADMIN),
    EMPLEADO: sanitizeStoredModules(source.EMPLEADO),
    CLIENTE: sanitizeStoredModules(source.CLIENTE),
  };
}

export async function getStoredRoleModuleAccessMap(): Promise<RoleModuleAccessMap> {
  try {
    await ensureAppSettingTable();

    const rows = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT "value"
      FROM "AppSetting"
      WHERE "key" = ${ADMIN_MODULE_ACCESS_SETTING_KEY}
      LIMIT 1
    `;

    const rawValue = rows[0]?.value;
    if (!rawValue) {
      return {};
    }

    return sanitizeRoleModuleAccessMap(JSON.parse(rawValue));
  } catch {
    return {};
  }
}

export async function setStoredRoleModuleAccessMap(value: RoleModuleAccessMap): Promise<void> {
  await ensureAppSettingTable();
  await prisma.$executeRaw`
    INSERT INTO "AppSetting" ("key", "value", "createdAt", "updatedAt")
    VALUES (${ADMIN_MODULE_ACCESS_SETTING_KEY}, ${JSON.stringify(value)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("key")
    DO UPDATE SET
      "value" = EXCLUDED."value",
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}

export function getDefaultAdminModuleAccess(role?: Role): Record<AdminModuleKey, boolean> {
  if (role === "ADMIN") {
    return Object.fromEntries(
      adminModuleDefinitions.map((item) => [item.key, defaultAdminVisibleModules.has(item.key)]),
    ) as Record<AdminModuleKey, boolean>;
  }

  if (role === "CLIENTE") {
    return Object.fromEntries(
      adminModuleDefinitions.map((item) => [item.key, item.key === "client_official_api"]),
    ) as Record<AdminModuleKey, boolean>;
  }

  return Object.fromEntries(
    adminModuleDefinitions.map((item) => [item.key, false]),
  ) as Record<AdminModuleKey, boolean>;
}

export async function getAdminModuleAccess(_userId?: string, role?: Role): Promise<Record<AdminModuleKey, boolean>> {
  const baseAccess = getDefaultAdminModuleAccess(role);
  if (!role) {
    return baseAccess;
  }

  const map = await getStoredRoleModuleAccessMap();
  const roleModules = map[role];
  if (!roleModules) {
    return baseAccess;
  }

  const allowed = new Set(roleModules);
  return Object.fromEntries(
    adminModuleDefinitions.map((item) => [item.key, allowed.has(item.key)]),
  ) as Record<AdminModuleKey, boolean>;
}

export async function hasAdminModuleAccess(
  userId: string | undefined,
  role: Role | undefined,
  moduleKey: AdminModuleKey,
): Promise<boolean> {
  if (!userId || role !== "ADMIN") {
    return false;
  }

  const access = await getAdminModuleAccess(userId, role);
  return access[moduleKey];
}

export function getVisibleAdminModuleDefinitions(access: Record<AdminModuleKey, boolean>) {
  return adminModuleDefinitions.filter((item) => access[item.key]);
}

export async function canAccessOfficialApiModule(
  userId: string | undefined,
  role: Role | undefined,
): Promise<boolean> {
  if (!userId || !role) {
    return false;
  }

  if (role === "ADMIN") {
    return true;
  }

  if (role !== "CLIENTE") {
    return false;
  }

  const access = await getAdminModuleAccess(userId, role);
  return access.client_official_api;
}
