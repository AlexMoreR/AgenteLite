"use client";

import * as React from "react";
import Link from "next/link";
import { Role } from "@prisma/client";
import {
  CalendarClock,
  Mail,
  MoreHorizontal,
  Search,
  Shield,
  Save,
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
import { OfficialApiClientSummary } from "@/components/admin/official-api-client-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OfficialApiAdminSummary } from "@/features/official-api";
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
      name: string;
      planTier: WorkspacePlanTier | null;
      planExpiresAt: Date | null;
      officialApiConfig: {
        accessToken: string | null;
        phoneNumberId: string | null;
        wabaId: string | null;
        webhookVerifyToken: string | null;
        appSecret: string | null;
        status: "NOT_CONNECTED" | "CONNECTED" | "ERROR";
      } | null;
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
  const activeOfficialApiSummary: OfficialApiAdminSummary = activeWorkspace
    ? {
        workspaceId: activeWorkspace.id,
        workspaceName: activeWorkspace.name,
        setupStatus:
          activeWorkspace.officialApiConfig?.status === "CONNECTED" ? "connected" : "pending",
        hasWorkspace: true,
        hasCredentials: Boolean(
          activeWorkspace.officialApiConfig?.accessToken &&
            activeWorkspace.officialApiConfig?.phoneNumberId &&
            activeWorkspace.officialApiConfig?.wabaId,
        ),
        configuredFields: [
          activeWorkspace.officialApiConfig?.accessToken ? "access_token" : null,
          activeWorkspace.officialApiConfig?.phoneNumberId ? "phone_number_id" : null,
          activeWorkspace.officialApiConfig?.wabaId ? "waba_id" : null,
          activeWorkspace.officialApiConfig?.webhookVerifyToken ? "webhook_verify_token" : null,
          activeWorkspace.officialApiConfig?.appSecret ? "app_secret" : null,
        ].filter((field): field is string => Boolean(field)),
      }
    : {
        workspaceId: null,
        workspaceName: null,
        setupStatus: "pending",
        hasWorkspace: false,
        hasCredentials: false,
        configuredFields: [],
      };

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

  const roleOptions: Array<{ value: Role; label: string }> = [
    { value: "ADMIN", label: "ADMIN" },
    { value: "EMPLEADO", label: "EMPLEADO" },
    { value: "CLIENTE", label: "CLIENTE" },
  ];

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
                        {user.role === "CLIENTE" || user.role === "ADMIN" ? (
                          <DropdownMenuItem asChild>
                            <Link href={`/admin/configuracion/usuarios/${user.id}/api-oficial`}>
                              Configurar api oficial WhatsApp
                            </Link>
                          </DropdownMenuItem>
                        ) : null}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm"
          onClick={() => setActiveUserId(null)}
        >
          <Card
            className="w-full max-w-3xl overflow-hidden p-0 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.32)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-5 border-b border-border bg-gradient-to-b from-slate-50 to-white px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Gestion de usuario
                  </p>
                  <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                    {activeUser.name || "Sin nombre"}
                  </h2>
                  <p className="text-sm text-muted-foreground">{activeUser.email}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setActiveUserId(null)}
                  aria-label="Cerrar"
                >
                  <X />
                </Button>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                <Card className="border-border px-3 py-3 shadow-none">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-slate-900 text-white">
                      <UserRound />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Rol actual
                      </p>
                      <Badge variant="outline" className={`${roleBadgeClass[activeUser.role]} h-5 border-0 px-2 text-[11px]`}>
                        {roleLabel[activeUser.role]}
                      </Badge>
                    </div>
                  </div>
                </Card>

                <Card className="border-border px-3 py-3 shadow-none">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-slate-900 text-white">
                      <Shield />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Plan
                      </p>
                      {activeWorkspace?.planTier ? (
                        <Badge variant="outline" className={`${planBadgeClass[activeWorkspace.planTier]} h-5 border-0 px-2 text-[11px]`}>
                          {getWorkspacePlanLabel(activeWorkspace.planTier)}
                        </Badge>
                      ) : activeUser.role === "CLIENTE" ? (
                        <p className="text-xs text-amber-700">Prueba pendiente</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Sin plan</p>
                      )}
                    </div>
                  </div>
                </Card>

                <Card className="border-border px-3 py-3 shadow-none">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-slate-900 text-white">
                      <CalendarClock />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Vencimiento
                      </p>
                      <p className={`text-xs ${activeUser.isPlanExpired ? "font-medium text-rose-600" : "text-foreground"}`}>
                        {activeWorkspace?.planExpiresAt
                          ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(activeWorkspace.planExpiresAt)
                          : activeUser.role === "CLIENTE"
                            ? "Se activa al configurar negocio"
                            : "Sin fecha"}
                      </p>
                      <p className={`text-[11px] ${activeUser.isPlanExpired ? "text-rose-500" : "text-muted-foreground"}`}>
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
                </Card>
              </div>
            </div>

            <div className="max-h-[calc(100vh-10rem)] overflow-y-auto p-6">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="border-border p-5 shadow-none">
                  <form action={adminUpdateUserRoleAction} className="flex h-full flex-col gap-4">
                    <input type="hidden" name="userId" value={activeUser.id} />
                    <div className="flex flex-col gap-1.5">
                      <p className="text-sm font-semibold text-foreground">Rol</p>
                    </div>
                    <div className="flex items-end gap-2">
                      <Select
                        value={getRoleValue(activeUser.id, activeUser.role)}
                        onValueChange={(value) => handleRoleChange(activeUser.id, value as Role)}
                      >
                        <SelectTrigger className="h-11 flex-1 rounded-xl border-border bg-background px-4 text-sm shadow-none">
                          <SelectValue placeholder="Selecciona rol" />
                        </SelectTrigger>
                        <SelectContent align="start" className="min-w-44 rounded-xl border-border bg-background p-1 shadow-lg">
                          {roleOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="submit"
                        size="icon"
                        className="size-9 rounded-xl"
                        aria-label="Guardar rol"
                        title="Guardar rol"
                      >
                        <Save data-icon="inline-start" />
                      </Button>
                    </div>
                  </form>
                </Card>

                <Card className="border-border p-5 shadow-none">
                  <form action={adminUpdateWorkspacePlanExpiryAction} className="flex h-full flex-col gap-4">
                    <input type="hidden" name="workspaceId" value={activeWorkspace?.id ?? ""} />
                    <div className="flex flex-col gap-1.5">
                      <p className="text-sm font-semibold text-foreground">Fecha de vencimiento</p>

                    </div>
                    <div className="flex items-end gap-2">
                      <Input
                        type="date"
                        name="planExpiresAt"
                        value={selectedExpiryDates[activeUser.id] ?? ""}
                        onChange={(event) => handleExpiryDateChange(activeUser.id, event.target.value)}
                        className="h-11 flex-1 rounded-xl"
                        disabled={!activeWorkspace}
                      />
                      <Button
                        type="submit"
                        variant="outline"
                        size="icon"
                        className="size-9 rounded-xl"
                        disabled={!activeWorkspace}
                        aria-label="Guardar fecha"
                        title="Guardar fecha"
                      >
                        <Save data-icon="inline-start" />
                      </Button>
                    </div>
                  </form>
                </Card>

                {activeUser.role === "CLIENTE" ? (
                  <div className="lg:col-span-2">
                    <OfficialApiClientSummary summary={activeOfficialApiSummary} />
                  </div>
                ) : null}
              </div>

              <Separator className="my-6" />

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="border-border p-5 shadow-none">
                  <form action={adminSendPasswordResetAction}>
                    <input type="hidden" name="userId" value={activeUser.id} />
                    <Button type="submit" variant="outline" className="h-10 rounded-xl px-4">
                      <Mail />
                      Enviar recuperacion por correo
                    </Button>
                  </form>
                </Card>

                <Card className="border-rose-200 bg-rose-50/60 p-5 shadow-none">
                  <form
                    action={adminDeleteUserAction}
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
                      <Trash2 />
                      Eliminar usuario
                    </Button>
                  </form>
                </Card>
              </div>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

