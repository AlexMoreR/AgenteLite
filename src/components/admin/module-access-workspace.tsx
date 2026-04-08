"use client";

import * as React from "react";
import { Role } from "@prisma/client";
import {
  Blocks,
  BriefcaseBusiness,
  MessageSquare,
  MessageSquareMore,
  LockKeyhole,
  Package,
  ShieldCheck,
  Tags,
  Truck,
  UserCog,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { adminUpdateUserModuleAccessAction } from "@/app/actions/auth-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AdminModuleKey } from "@/lib/admin-module-access";

type ModuleDefinition = {
  key: AdminModuleKey;
  label: string;
  description: string;
  group: string;
};

type RoleModuleAccessRow = {
  role: Role;
  modules: AdminModuleKey[];
};

type ModuleAccessWorkspaceProps = {
  roles: RoleModuleAccessRow[];
  modules: ModuleDefinition[];
};

const roleLabel: Record<Role, string> = {
  ADMIN: "Admin",
  EMPLEADO: "Empleado",
  CLIENTE: "Cliente",
};

const roleIconMap = {
  ADMIN: ShieldCheck,
  EMPLEADO: BriefcaseBusiness,
  CLIENTE: UserRound,
} satisfies Record<Role, React.ComponentType<{ className?: string }>>;

const moduleIconMap = {
  config_users: Users,
  config_business: BriefcaseBusiness,
  config_permissions: UserCog,
  config_whatsapp: MessageSquareMore,
  products: Package,
  categories: Tags,
  suppliers: Truck,
  quotes: Blocks,
  client_official_api: MessageSquare,
} satisfies Record<AdminModuleKey, React.ComponentType<{ className?: string }>>;

export function ModuleAccessWorkspace({ roles, modules }: ModuleAccessWorkspaceProps) {
  const [activeRole, setActiveRole] = React.useState<Role | null>(null);

  const currentRole = roles.find((item) => item.role === activeRole) ?? null;
  const groupedModules = React.useMemo(() => {
    const groups = new Map<string, ModuleDefinition[]>();

    for (const moduleItem of modules) {
      const current = groups.get(moduleItem.group) ?? [];
      current.push(moduleItem);
      groups.set(moduleItem.group, current);
    }

    return Array.from(groups.entries());
  }, [modules]);

  return (
    <>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          {roles.map((roleItem) => {
            const RoleIcon = roleIconMap[roleItem.role];

            return (
            <Card key={roleItem.role} className="space-y-4 border border-[var(--line)]">
              <div className="flex items-start gap-3">
                <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                  <RoleIcon className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-slate-900">{roleLabel[roleItem.role]}</h3>
                  <p className="text-xs text-slate-500">
                    {roleItem.modules.length} modulo{roleItem.modules.length === 1 ? "" : "s"} activo{roleItem.modules.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {roleItem.modules.map((moduleKey) => {
                  const moduleItem = modules.find((item) => item.key === moduleKey);
                  const ModuleIcon = moduleItem ? moduleIconMap[moduleItem.key] : null;
                  return moduleItem ? (
                    <span
                      key={moduleItem.key}
                      className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700"
                    >
                      {ModuleIcon ? <ModuleIcon className="h-3.5 w-3.5" /> : null}
                      {moduleItem.label}
                    </span>
                  ) : null;
                })}
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => setActiveRole(roleItem.role)}
              >
                Configurar rol
              </Button>
            </Card>
          )})}
        </div>
      </div>

      {currentRole ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#11182752] px-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Permisos del rol ${roleLabel[currentRole.role]}`}
          onClick={() => setActiveRole(null)}
        >
          <Card
            className="w-full max-w-2xl space-y-4 rounded-xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-slate-900">
                  <LockKeyhole className="h-4 w-4 text-slate-500" />
                  Control de modulos por rol
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Define que modulos puede ver y abrir el rol{" "}
                  <span className="font-medium text-slate-800">{roleLabel[currentRole.role]}</span>.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={() => setActiveRole(null)}
              >
                <X className="h-4 w-4 text-slate-500" />
              </Button>
            </div>

            {currentRole.role === "ADMIN" ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  El rol Admin conserva activo <span className="font-semibold">Control de modulos</span> para evitar bloqueo total del sistema.
                </p>
              </div>
            ) : null}

            <form action={adminUpdateUserModuleAccessAction} className="space-y-4">
              <input type="hidden" name="role" value={currentRole.role} />

              {groupedModules.map(([group, groupModules]) => (
                <div key={group} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</p>
                  <div className="grid gap-2">
                    {groupModules.map((moduleItem) => {
                      const ModuleIcon = moduleIconMap[moduleItem.key];
                      const isChecked =
                        currentRole.modules.includes(moduleItem.key) ||
                        (currentRole.role === "ADMIN" && moduleItem.key === "config_permissions");
                      const isDisabled =
                        currentRole.role === "ADMIN" && moduleItem.key === "config_permissions";

                      return (
                        <label
                          key={moduleItem.key}
                          className="flex items-start gap-3 rounded-lg border border-[var(--line)] bg-slate-50/60 px-3 py-3"
                        >
                          <input
                            type="checkbox"
                            name="modules"
                            value={moduleItem.key}
                            defaultChecked={isChecked}
                            disabled={isDisabled}
                            className="mt-1 h-4 w-4 rounded border-[var(--line)] text-[var(--primary)]"
                          />
                          <span className="space-y-0.5">
                            <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                              <ModuleIcon className="h-4 w-4 text-slate-500" />
                              {moduleItem.label}
                            </span>
                            <span className="block text-xs text-slate-600">{moduleItem.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setActiveRole(null)}
                >
                  Cancelar
                </Button>
                <Button type="submit">
                  Guardar permisos
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </>
  );
}
