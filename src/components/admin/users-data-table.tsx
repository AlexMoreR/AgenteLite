"use client";

import * as React from "react";
import { Role } from "@prisma/client";
import {
  CalendarClock,
  Mail,
  MoreHorizontal,
  Search,
  Shield,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import {
  adminSendPasswordResetAction,
  adminDeleteUserAction,
  adminUpdateUserRoleAction,
  adminUpdateWorkspacePlanExpiryAction,
} from "@/app/actions/auth-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
  const [activeUserId, setActiveUserId] = React.useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = React.useState<Record<string, Role>>({});
  const [selectedExpiryDates, setSelectedExpiryDates] = React.useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        users.map((user) => [
          user.id,
          user.workspaceMemberships[0]?.workspace.planExpiresAt
            ? new Date(user.workspaceMemberships[0].workspace.planExpiresAt)
                .toISOString()
                .slice(0, 10)
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
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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

  React.useEffect(() => {
    if (!activeUserId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveUserId(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeUserId]);

  const pageStart = (page - 1) * PAGE_SIZE;
  const pagedUsers = filteredUsers.slice(pageStart, pageStart + PAGE_SIZE);
  const rangeStart = filteredUsers.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + PAGE_SIZE, filteredUsers.length);
  const activeUser = activeUserId ? users.find((user) => user.id === activeUserId) ?? null : null;
  const activeWorkspace = activeUser?.workspaceMemberships[0]?.workspace;

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

  const handleRoleChange = (userId: string, role: Role) => {
    setSelectedRoles((current) => ({ ...current, [userId]: role }));
  };

  const handleExpiryDateChange = (userId: string, value: string) => {
    setSelectedExpiryDates((current) => ({ ...current, [userId]: value }));
  };

  const getPlanDisplay = (user: UserRow) => {
    const primaryWorkspace = user.workspaceMemberships[0]?.workspace;

    if (primaryWorkspace?.planTier) {
      return {
        kind: "assigned" as const,
        label: getWorkspacePlanLabel(primaryWorkspace.planTier),
        expiresLabel: primaryWorkspace.planExpiresAt
          ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(primaryWorkspace.planExpiresAt)
          : "Sin fecha",
        statusLabel: primaryWorkspace.planExpiresAt
          ? user.isPlanExpired
            ? "Vencido"
            : "Activo"
          : "Sin vencimiento",
      };
    }

    if (user.role === "CLIENTE") {
      return {
        kind: "pending" as const,
        label: "Prueba gratis pendiente",
        expiresLabel: "Se activa al configurar negocio",
        statusLabel: "Pendiente",
      };
    }

    return {
      kind: "none" as const,
      label: "Sin plan",
      expiresLabel: "Sin fecha",
      statusLabel: "Sin vencimiento",
    };
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b border-[var(--line)] pb-4 md:flex-row md:items-center md:justify-between">
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
            className="h-10 rounded-xl pr-9 pl-9 text-sm"
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

      <Table className="min-w-[720px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="normal-case tracking-normal">Usuario</TableHead>
            <TableHead className="normal-case tracking-normal">Alta</TableHead>
            <TableHead className="normal-case tracking-normal">Suscripcion</TableHead>
            <TableHead className="normal-case tracking-normal">Rol</TableHead>
            <TableHead className="text-right normal-case tracking-normal">Accion</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pagedUsers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-slate-500">
                No hay resultados para el filtro actual.
              </TableCell>
            </TableRow>
          ) : (
            pagedUsers.map((user) => {
              const primaryWorkspace = user.workspaceMemberships[0]?.workspace;
              const planDisplay = getPlanDisplay(user);

              return (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-xs font-semibold text-slate-700">
                        {(user.name?.charAt(0) || user.email.charAt(0)).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{user.name || "Sin nombre"}</p>
                        <p className="truncate text-xs text-slate-500">{user.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(user.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-2">
                      {planDisplay.kind === "assigned" && primaryWorkspace?.planTier ? (
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${planBadgeClass[primaryWorkspace.planTier]}`}
                        >
                          {planDisplay.label}
                        </span>
                      ) : planDisplay.kind === "pending" ? (
                        <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                          {planDisplay.label}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-500">{planDisplay.label}</span>
                      )}
                      <div className="text-sm">
                        <p
                          className={
                            planDisplay.kind === "assigned" && user.isPlanExpired
                              ? "font-medium text-rose-600"
                              : "text-slate-700"
                          }
                        >
                          {planDisplay.expiresLabel}
                        </p>
                        <p
                          className={`text-xs ${
                            planDisplay.kind === "assigned" && user.isPlanExpired
                              ? "text-rose-500"
                              : "text-slate-500"
                          }`}
                        >
                          {planDisplay.statusLabel}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${roleBadgeClass[user.role]}`}>
                      {roleLabel[user.role]}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-full px-3"
                        >
                          Gestionar
                          <MoreHorizontal className="ml-1 h-4 w-4 text-slate-500" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44 rounded-xl">
                        <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setActiveUserId(user.id)}>
                          Ver y editar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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

      {activeUser ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#11182752] px-4 py-6 backdrop-blur-[2px]"
          onClick={() => setActiveUserId(null)}
        >
          <div
            className="saas-card w-full max-w-3xl overflow-hidden rounded-[1.6rem] p-0 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.28)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-[var(--line)] bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Gestion de usuario
                  </p>
                  <h2 className="text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">
                    {activeUser.name || "Sin nombre"}
                  </h2>
                  <p className="text-sm text-slate-500">{activeUser.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveUserId(null)}
                  className="rounded-full border border-[var(--line)] p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-[1.1rem] border border-[var(--line)] bg-white px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-slate-900 p-2 text-white">
                      <UserRound className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        Rol actual
                      </p>
                      <span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${roleBadgeClass[activeUser.role]}`}>
                        {roleLabel[activeUser.role]}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.1rem] border border-[var(--line)] bg-white px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-slate-900 p-2 text-white">
                      <Shield className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        Plan
                      </p>
                      {activeWorkspace?.planTier ? (
                        <span
                          className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${planBadgeClass[activeWorkspace.planTier]}`}
                        >
                          {getWorkspacePlanLabel(activeWorkspace.planTier)}
                        </span>
                      ) : activeUser.role === "CLIENTE" ? (
                        <p className="mt-1 text-sm text-amber-700">Prueba gratis pendiente de activacion</p>
                      ) : (
                        <p className="mt-1 text-sm text-slate-500">Sin plan asignado</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.1rem] border border-[var(--line)] bg-white px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-slate-900 p-2 text-white">
                      <CalendarClock className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        Vencimiento
                      </p>
                      <p className={`mt-1 text-sm ${activeUser.isPlanExpired ? "font-medium text-rose-600" : "text-slate-700"}`}>
                        {activeWorkspace?.planExpiresAt
                          ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(activeWorkspace.planExpiresAt)
                          : activeUser.role === "CLIENTE"
                            ? "Se activa al configurar negocio"
                            : "Sin fecha"}
                      </p>
                      <p className={`mt-1 text-xs ${activeUser.isPlanExpired ? "text-rose-500" : "text-slate-500"}`}>
                        {activeWorkspace?.planExpiresAt
                          ? activeUser.isPlanExpired
                            ? "Vencido"
                            : "Activo"
                          : activeUser.role === "CLIENTE"
                            ? "Pendiente"
                            : "Sin vencimiento"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="max-h-[calc(100vh-10rem)] overflow-y-auto p-6">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-[1.25rem] border border-[var(--line)] p-5">
                  <p className="text-sm font-semibold text-slate-900">Rol y permisos</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Cambia el rol principal del usuario desde un formulario separado.
                  </p>
                  <form action={adminUpdateUserRoleAction} className="mt-5 space-y-3">
                    <input type="hidden" name="userId" value={activeUser.id} />
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-slate-700">Rol</span>
                      <select
                        name="role"
                        className="field-select h-11 rounded-xl"
                        value={getRoleValue(activeUser.id, activeUser.role)}
                        onChange={(event) => handleRoleChange(activeUser.id, event.target.value as Role)}
                      >
                        <option value="ADMIN">ADMIN</option>
                        <option value="EMPLEADO">EMPLEADO</option>
                        <option value="CLIENTE">CLIENTE</option>
                      </select>
                    </label>
                    <Button type="submit" className="h-10 rounded-xl px-4">
                      Guardar rol
                    </Button>
                  </form>
                </div>

                <div className="rounded-[1.25rem] border border-[var(--line)] p-5">
                  <p className="text-sm font-semibold text-slate-900">Suscripcion</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Ajusta la fecha de vencimiento del negocio principal del usuario.
                  </p>
                  <form action={adminUpdateWorkspacePlanExpiryAction} className="mt-5 space-y-3">
                    <input type="hidden" name="workspaceId" value={activeWorkspace?.id ?? ""} />
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-slate-700">Fecha de vencimiento</span>
                      <Input
                        type="date"
                        name="planExpiresAt"
                        value={selectedExpiryDates[activeUser.id] ?? ""}
                        onChange={(event) => handleExpiryDateChange(activeUser.id, event.target.value)}
                        className="h-11 rounded-xl"
                        disabled={!activeWorkspace}
                      />
                    </label>
                    <Button
                      type="submit"
                      variant="outline"
                      className="h-10 rounded-xl px-4"
                      disabled={!activeWorkspace}
                    >
                      Guardar fecha
                    </Button>
                  </form>
                </div>
              </div>

              <div className="mt-4 rounded-[1.25rem] border border-[var(--line)] p-5">
                <p className="text-sm font-semibold text-slate-900">Recuperacion de acceso</p>
                <p className="mt-1 text-xs text-slate-500">
                  Envia al correo del usuario un enlace para crear una nueva contrasena.
                </p>
                <form action={adminSendPasswordResetAction} className="mt-4">
                  <input type="hidden" name="userId" value={activeUser.id} />
                  <Button type="submit" variant="outline" className="h-10 rounded-xl px-4">
                    <Mail className="mr-2 h-4 w-4" />
                    Enviar recuperacion por correo
                  </Button>
                </form>
              </div>

              <div className="mt-4 rounded-[1.25rem] border border-rose-200 bg-rose-50/60 p-5">
                <p className="text-sm font-semibold text-rose-700">Zona delicada</p>
                <p className="mt-1 text-xs text-rose-600">
                  Esta accion elimina la cuenta si no tiene restricciones asociadas.
                </p>
                <form
                  action={adminDeleteUserAction}
                  className="mt-4"
                  onSubmit={(event) => {
                    if (
                      !window.confirm(
                        `Eliminar a ${activeUser.name || activeUser.email}? Esta accion no se puede deshacer.`,
                      )
                    ) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="userId" value={activeUser.id} />
                  <Button
                    type="submit"
                    variant="outline"
                    className="h-10 rounded-xl border-rose-200 px-4 text-rose-600 hover:bg-rose-100 hover:text-rose-700"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Eliminar usuario
                  </Button>
                </form>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
