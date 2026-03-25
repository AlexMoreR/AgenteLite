"use client";

import * as React from "react";
import { Role } from "@prisma/client";
import { ChevronDown, Search, X } from "lucide-react";
import {
  adminDeleteUserAction,
  adminUpdateUserRoleAction,
  adminUpdateWorkspacePlanExpiryAction,
} from "@/app/actions/auth-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getWorkspacePlanLabel, type WorkspacePlanTier } from "@/lib/plans";

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  createdAt: Date;
  isPlanExpired: boolean;
  workspaceMemberships: Array<{
    workspace: {
      id: string;
      planTier: WorkspacePlanTier | null;
      planExpiresAt: Date | null;
    };
  }>;
};

type UsersDataTableProps = {
  users: UserRow[];
};

const PAGE_SIZE = 8;

export function UsersDataTable({ users }: UsersDataTableProps) {
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [selectedRoles, setSelectedRoles] = React.useState<Record<string, Role>>({});
  const [selectedExpiryDates, setSelectedExpiryDates] = React.useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        users.map((user) => [
          user.id,
          user.workspaceMemberships[0]?.workspace.planExpiresAt
            ? new Date(user.workspaceMemberships[0].workspace.planExpiresAt).toISOString().slice(0, 10)
            : "",
        ]),
      ),
  );

  const filteredUsers = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return users
      .filter((user) => {
        if (!normalizedQuery) return true;
        const haystack = `${user.name ?? ""} ${user.email}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .sort((a, b) => {
        const aTime = new Date(a.createdAt).getTime();
        const bTime = new Date(b.createdAt).getTime();
        return bTime - aTime;
      });
  }, [users, query]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));

  React.useEffect(() => {
    setPage(1);
  }, [query]);

  React.useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pageStart = (page - 1) * PAGE_SIZE;
  const pagedUsers = filteredUsers.slice(pageStart, pageStart + PAGE_SIZE);
  const rangeStart = filteredUsers.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + PAGE_SIZE, filteredUsers.length);

  const roleLabel: Record<Role, string> = {
    ADMIN: "Admin",
    EMPLEADO: "Empleado",
    CLIENTE: "Cliente",
  };

  const roleBadgeClass: Record<Role, string> = {
    ADMIN: "bg-blue-50 text-blue-700 ring-blue-200",
    EMPLEADO: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    CLIENTE: "bg-slate-100 text-slate-700 ring-slate-200",
  };

  const planBadgeClass: Record<WorkspacePlanTier, string> = {
    GRATIS: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    BASICO: "bg-blue-50 text-blue-700 ring-blue-200",
    AVANZADO: "bg-violet-50 text-violet-700 ring-violet-200",
  };

  const getRoleValue = (userId: string, fallbackRole: Role) =>
    selectedRoles[userId] ?? fallbackRole;

  const handleRoleSelect = (userId: string, role: Role) => {
    setSelectedRoles((current) => ({ ...current, [userId]: role }));
  };

  const handleExpiryDateChange = (userId: string, value: string) => {
    setSelectedExpiryDates((current) => ({ ...current, [userId]: value }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 border-b border-[var(--line)] pb-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Directorio de usuarios</p>
          <p className="text-xs text-slate-500">
            {filteredUsers.length} usuario{filteredUsers.length === 1 ? "" : "s"} en la vista actual
          </p>
        </div>
        <div className="relative w-full md:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nombre o correo"
            className="h-9 pr-9 pl-9 text-sm"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label="Limpiar busqueda"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <Table className="min-w-[980px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="normal-case tracking-normal">Usuario</TableHead>
            <TableHead className="normal-case tracking-normal">Alta</TableHead>
            <TableHead className="normal-case tracking-normal">Plan actual</TableHead>
            <TableHead className="normal-case tracking-normal">Vence</TableHead>
            <TableHead className="normal-case tracking-normal">Rol actual</TableHead>
            <TableHead className="normal-case tracking-normal">Rol</TableHead>
            <TableHead className="text-right normal-case tracking-normal">Accion</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pagedUsers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-slate-500">
                No hay resultados para el filtro actual.
              </TableCell>
            </TableRow>
          ) : (
            pagedUsers.map((user) => {
              const primaryWorkspace = user.workspaceMemberships[0]?.workspace;
              const planLabel = getWorkspacePlanLabel(primaryWorkspace?.planTier);
              const expiresLabel = primaryWorkspace?.planExpiresAt
                ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(primaryWorkspace.planExpiresAt)
                : "Sin fecha";

              return (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-700">
                        {(user.name?.charAt(0) || user.email.charAt(0)).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{user.name || "Sin nombre"}</p>
                        <p className="truncate text-xs text-slate-500">{user.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {new Date(user.createdAt).toLocaleDateString("es-MX")}
                  </TableCell>
                  <TableCell>
                    {primaryWorkspace?.planTier ? (
                      <span
                        className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ring-1 ${planBadgeClass[primaryWorkspace.planTier]}`}
                      >
                        {planLabel}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-500">Sin plan</span>
                    )}
                  </TableCell>
                <TableCell>
                  <div className="text-sm">
                      <p className={user.isPlanExpired ? "font-medium text-rose-600" : "text-slate-700"}>
                        {expiresLabel}
                      </p>
                      {primaryWorkspace?.planExpiresAt ? (
                        <p className={`text-xs ${user.isPlanExpired ? "text-rose-500" : "text-slate-500"}`}>
                          {user.isPlanExpired ? "Vencido" : "Activo"}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-500">Sin vencimiento</p>
                      )}
                  </div>
                </TableCell>
                <TableCell>
                  <span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ring-1 ${roleBadgeClass[user.role]}`}>
                    {roleLabel[user.role]}
                    </span>
                  </TableCell>
                  <TableCell>
                    <form id={`user-role-${user.id}`} action={adminUpdateUserRoleAction} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={user.id} />
                      <input type="hidden" name="role" value={getRoleValue(user.id, user.role)} />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 min-w-28 justify-between px-2 text-[11px] font-semibold"
                          >
                            {roleLabel[getRoleValue(user.id, user.role)]}
                            <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="min-w-28 rounded-lg">
                          <DropdownMenuItem onSelect={() => handleRoleSelect(user.id, "ADMIN")}>
                            ADMIN
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => handleRoleSelect(user.id, "EMPLEADO")}>
                            EMPLEADO
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => handleRoleSelect(user.id, "CLIENTE")}>
                            CLIENTE
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </form>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <form
                      action={adminDeleteUserAction}
                      onSubmit={(event) => {
                        if (!window.confirm(`Eliminar a ${user.name || user.email}? Esta accion no se puede deshacer.`)) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="userId" value={user.id} />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        className="h-8 border-rose-200 px-2.5 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      >
                        Eliminar
                      </Button>
                    </form>
                    <form
                      action={adminUpdateWorkspacePlanExpiryAction}
                      className="flex items-center gap-2"
                    >
                      <input
                        type="hidden"
                        name="workspaceId"
                        value={primaryWorkspace?.id ?? ""}
                      />
                      <Input
                        type="date"
                        name="planExpiresAt"
                        value={selectedExpiryDates[user.id] ?? ""}
                        onChange={(event) => handleExpiryDateChange(user.id, event.target.value)}
                        className="h-8 w-36 text-xs"
                        disabled={!primaryWorkspace}
                      />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2.5 text-xs"
                        disabled={!primaryWorkspace}
                      >
                        Guardar fecha
                      </Button>
                    </form>
                    <Button
                      type="submit"
                      form={`user-role-${user.id}`}
                      variant="outline"
                      size="sm"
                      className="h-8 px-2.5 text-xs"
                    >
                      Aplicar
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Mostrando {rangeStart}-{rangeEnd} de {filteredUsers.length}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1}
          >
            Anterior
          </Button>
          <span className="text-xs text-slate-600">
            Pagina {page} de {totalPages}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages}
          >
            Siguiente
          </Button>
        </div>
      </div>
    </div>
  );
}
