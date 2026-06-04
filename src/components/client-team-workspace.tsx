"use client";

import * as React from "react";
import { Mail, MoreHorizontal, Pencil, Power, RotateCcw, Save, Send, UserPlus } from "lucide-react";
import {
  clientDeactivateEmployeeAction,
  clientInviteEmployeeAction,
  clientReactivateEmployeeAction,
  clientResendEmployeeInviteAction,
  clientUpdateEmployeeModulesAction,
} from "@/app/actions/client-team-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  clientAssignableModuleDefinitions,
  defaultClientEmployeeModuleKeys,
  type ClientAssignableModuleKey,
} from "@/lib/client-workspace-modules";

type EmployeeRow = {
  id: string;
  name: string;
  email: string;
  status: "pending" | "active" | "inactive";
  statusLabel: string;
  modules: ClientAssignableModuleKey[];
  invitedAtLabel: string;
  acceptedAtLabel: string;
};

type ClientTeamWorkspaceProps = {
  employees: EmployeeRow[];
};

function ModuleCheckboxes({
  selected,
  onChange,
}: {
  selected: ClientAssignableModuleKey[];
  onChange: (next: ClientAssignableModuleKey[]) => void;
}) {
  const selectedSet = new Set(selected);

  return (
    <FieldSet>
      <FieldLegend variant="label">Modulos</FieldLegend>
      <FieldGroup data-slot="checkbox-group" className="grid gap-3 sm:grid-cols-2">
        {clientAssignableModuleDefinitions.map((module) => {
          const checked = selectedSet.has(module.key);

          return (
            <Field key={module.key} orientation="horizontal">
              <Checkbox
                checked={checked}
                onCheckedChange={(nextChecked) => {
                  const next = Boolean(nextChecked)
                    ? [...selected, module.key]
                    : selected.filter((key) => key !== module.key);
                  onChange(Array.from(new Set(next)));
                }}
              />
              <FieldContent>
                <FieldTitle>{module.label}</FieldTitle>
              </FieldContent>
            </Field>
          );
        })}
      </FieldGroup>
    </FieldSet>
  );
}

function ModuleHiddenInputs({ modules }: { modules: ClientAssignableModuleKey[] }) {
  return (
    <>
      {modules.map((module) => (
        <input key={module} type="hidden" name="modules" value={module} />
      ))}
    </>
  );
}

function InviteEmployeeDialog() {
  const [modules, setModules] = React.useState<ClientAssignableModuleKey[]>(
    Array.from(defaultClientEmployeeModuleKeys),
  );

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button type="button" size="sm">
            <UserPlus data-icon="inline-start" />
            Invitar
          </Button>
        }
      />
      <DialogContent className="flex! max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Invitar empleado</DialogTitle>
          <DialogDescription>
            Crea el acceso del empleado y envia un enlace para establecer contrasena.
          </DialogDescription>
        </DialogHeader>

        <form action={clientInviteEmployeeAction} className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="employee-name">Nombre</FieldLabel>
                <Input id="employee-name" name="name" type="text" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="employee-email">Correo</FieldLabel>
                <Input id="employee-email" name="email" type="email" required />
              </Field>
            </FieldGroup>

            <Separator />
            <ModuleCheckboxes selected={modules} onChange={setModules} />
          </div>
          <ModuleHiddenInputs modules={modules} />

          <DialogFooter>
            <Button type="submit">
              <Send data-icon="inline-start" />
              Enviar invitacion
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditModulesDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: EmployeeRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [modules, setModules] = React.useState<ClientAssignableModuleKey[]>(employee.modules);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex! max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Permisos de {employee.name}</DialogTitle>
          <DialogDescription>
            Define los modulos visibles para este empleado.
          </DialogDescription>
        </DialogHeader>

        <form action={clientUpdateEmployeeModulesAction} className="flex min-h-0 flex-1 flex-col gap-4">
          <input type="hidden" name="memberId" value={employee.id} />
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            <ModuleCheckboxes selected={modules} onChange={setModules} />
          </div>
          <ModuleHiddenInputs modules={modules} />

          <DialogFooter>
            <Button type="submit">
              <Save data-icon="inline-start" />
              Guardar permisos
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeStatusBadge({ status, label }: { status: EmployeeRow["status"]; label: string }) {
  const variant = status === "inactive" ? "destructive" : status === "pending" ? "secondary" : "outline";

  return <Badge variant={variant}>{label}</Badge>;
}

function EmployeeActions({ employee }: { employee: EmployeeRow }) {
  const [editOpen, setEditOpen] = React.useState(false);

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button type="button" variant="ghost" size="icon-sm">
              <MoreHorizontal />
              <span className="sr-only">Acciones</span>
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil />
            Editar
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {employee.status !== "inactive" ? (
            <form action={clientResendEmployeeInviteAction}>
              <input type="hidden" name="memberId" value={employee.id} />
              <DropdownMenuItem className="w-full" render={<button type="submit" />}>
                <Mail />
                Reenviar
              </DropdownMenuItem>
            </form>
          ) : null}

          {employee.status === "inactive" ? (
            <form action={clientReactivateEmployeeAction}>
              <input type="hidden" name="memberId" value={employee.id} />
              <DropdownMenuItem className="w-full" render={<button type="submit" />}>
                <RotateCcw />
                Reactivar
              </DropdownMenuItem>
            </form>
          ) : (
            <form action={clientDeactivateEmployeeAction}>
              <input type="hidden" name="memberId" value={employee.id} />
              <DropdownMenuItem variant="destructive" className="w-full" render={<button type="submit" />}>
                <Power />
                Desactivar
              </DropdownMenuItem>
            </form>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditModulesDialog employee={employee} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}

export function ClientTeamWorkspace({ employees }: ClientTeamWorkspaceProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Equipo</CardTitle>
        <CardAction>
          <InviteEmployeeDialog />
        </CardAction>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empleado</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Modulos</TableHead>
              <TableHead>Invitacion</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No hay empleados invitados.
                </TableCell>
              </TableRow>
            ) : (
              employees.map((employee) => (
                <TableRow key={employee.id}>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{employee.name}</span>
                      <span className="text-muted-foreground">{employee.email}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <EmployeeStatusBadge status={employee.status} label={employee.statusLabel} />
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-md flex-wrap gap-1.5">
                      {employee.modules.length === 0 ? (
                        <span className="text-muted-foreground">Sin modulos</span>
                      ) : (
                        employee.modules.map((module) => {
                          const definition = clientAssignableModuleDefinitions.find((item) => item.key === module);
                          return (
                            <Badge key={module} variant="secondary">
                              {definition?.label ?? module}
                            </Badge>
                          );
                        })
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 text-muted-foreground">
                      <span>{employee.invitedAtLabel}</span>
                      <span>{employee.acceptedAtLabel}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <EmployeeActions employee={employee} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
