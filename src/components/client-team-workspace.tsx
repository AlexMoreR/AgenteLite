"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Mail, MoreHorizontal, Pencil, Power, RotateCcw, Send, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  clientDeactivateEmployeeAction,
  clientDemoteAdminToEmployeeAction,
  clientInviteEmployeeAction,
  clientPromoteEmployeeToAdminAction,
  clientReactivateEmployeeAction,
  clientResendEmployeeInviteAction,
} from "@/app/actions/client-team-actions";
import { guardarPersonaDelEquipoAction } from "@/app/actions/equipo-actions";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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

export type EstadoDeLinea = "no" | "recibe" | "pausa" | "monitorea";

type LineaDeLaPersona = { channelId: string; nombre: string; estado: EstadoDeLinea; abierta: boolean };

type EmployeeRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  // "admin" = administrador del negocio (acceso total, sin restriccion de modulos);
  // "employee" = empleado con modulos asignados.
  role: "admin" | "employee";
  /** Asesora con permiso de supervisar: ve al equipo, asigna chats y corre automatizaciones. */
  esSupervisora: boolean;
  status: "pending" | "active" | "inactive";
  statusLabel: string;
  modules: ClientAssignableModuleKey[];
  lineas: LineaDeLaPersona[];
  invitedAtLabel: string;
  acceptedAtLabel: string;
};

type ClientTeamWorkspaceProps = {
  employees: EmployeeRow[];
};

const ESTADOS_DE_LINEA: Array<{ valor: EstadoDeLinea; titulo: string }> = [
  { valor: "no", titulo: "No trabaja esta línea" },
  { valor: "recibe", titulo: "Recibe leads" },
  { valor: "pausa", titulo: "En pausa (no le entran leads nuevos)" },
  { valor: "monitorea", titulo: "Solo monitorea (no escribe, números tapados)" },
];

const CHAPA_DE_LINEA: Record<Exclude<EstadoDeLinea, "no">, { texto: string; clase: string }> = {
  recibe: {
    texto: "Recibe leads",
    clase: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300",
  },
  pausa: {
    texto: "En pausa",
    clase: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300",
  },
  monitorea: {
    texto: "Monitorea",
    clase: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300",
  },
};

function etiquetaDeModulo(clave: ClientAssignableModuleKey) {
  return clientAssignableModuleDefinitions.find((item) => item.key === clave)?.label ?? clave;
}

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
      <FieldLegend variant="label">Pantallas que ve</FieldLegend>
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
          <DialogTitle>Invitar a alguien al equipo</DialogTitle>
          <DialogDescription>
            Le llega un correo para crear su contraseña. El rol y las líneas se ajustan después en Editar.
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

/**
 * Todo lo de una persona en un solo lugar: rol, lineas de WhatsApp y pantallas (Alex, 15-sep-2026).
 *
 * Antes lo de las lineas se editaba en Conexion y las pantallas en dos lugares distintos; quien
 * configuraba a una asesora tenia que recorrer tres pantallas y siempre se olvidaba una.
 */
function EditarPersonaDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: EmployeeRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const esAdmin = employee.role === "admin";
  const [rol, setRol] = React.useState<"asesora" | "supervisora">(employee.esSupervisora ? "supervisora" : "asesora");
  const [modules, setModules] = React.useState<ClientAssignableModuleKey[]>(employee.modules);
  const [lineas, setLineas] = React.useState<LineaDeLaPersona[]>(employee.lineas);
  const [guardando, startTransition] = React.useTransition();

  const guardar = () =>
    startTransition(async () => {
      const resultado = await guardarPersonaDelEquipoAction({
        memberId: employee.id,
        rol,
        modulos: modules,
        lineas: lineas.map((linea) => ({ channelId: linea.channelId, estado: linea.estado })),
      });
      if ("error" in resultado) {
        toast.error(resultado.error);
        return;
      }
      toast.success("Guardado");
      onOpenChange(false);
      router.refresh();
    });

  const roles = [
    { valor: "asesora" as const, titulo: "Asesora", detalle: "Atiende sus chats y ve solo sus números." },
    {
      valor: "supervisora" as const,
      titulo: "Supervisora",
      detalle: "Además ve al equipo (tableros, llamadas y grabaciones), asigna chats a cualquiera y corre automatizaciones.",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex! max-h-[88vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{employee.name}</DialogTitle>
          <DialogDescription>{employee.email}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-1">
          <section className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Rol</p>
            {esAdmin ? (
              <p className="text-sm text-muted-foreground">
                Administrador: tiene acceso total. Para cambiarlo usá “Pasar a empleado” en el menú.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {roles.map((opcion) => (
                  <button
                    key={opcion.valor}
                    type="button"
                    onClick={() => setRol(opcion.valor)}
                    className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition ${
                      rol === opcion.valor ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 size-3.5 shrink-0 rounded-full border-2 ${
                        rol === opcion.valor ? "border-primary bg-primary" : "border-muted-foreground/40"
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{opcion.titulo}</span>
                      <span className="block text-xs leading-snug text-muted-foreground">{opcion.detalle}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Líneas de WhatsApp</p>
            {lineas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay líneas conectadas.</p>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border">
                {lineas.map((linea) => (
                  <div key={linea.channelId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{linea.nombre}</span>
                    {linea.abierta ? (
                      <span className="text-xs text-muted-foreground sm:max-w-64 sm:text-right">
                        Abierta a todo el equipo. Para repartirla, agregá colaboradores en Conexión.
                      </span>
                    ) : (
                      <NativeSelect
                        className="w-full text-[16px] sm:w-72 md:text-sm"
                        value={linea.estado}
                        onChange={(evento) => {
                          const estado = evento.target.value as EstadoDeLinea;
                          setLineas((actuales) =>
                            actuales.map((fila) => (fila.channelId === linea.channelId ? { ...fila, estado } : fila)),
                          );
                        }}
                      >
                        {ESTADOS_DE_LINEA.map((opcion) => (
                          <NativeSelectOption key={opcion.valor} value={opcion.valor}>
                            {opcion.titulo}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {esAdmin ? null : <ModuleCheckboxes selected={modules} onChange={setModules} />}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="button" onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeStatusBadge({ status, label }: { status: EmployeeRow["status"]; label: string }) {
  const variant = status === "inactive" ? "destructive" : status === "pending" ? "secondary" : "outline";

  return <Badge variant={variant}>{label}</Badge>;
}

// Acciones de un ADMINISTRADOR del negocio: editar sus lineas o bajarlo a empleado (sus pantallas
// no se gestionan porque tiene acceso total).
function AdminActions({ employee }: { employee: EmployeeRow }) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
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
            Editar líneas
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setConfirmOpen(true)}>
            <UserMinus />
            Pasar a empleado
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editOpen ? <EditarPersonaDialog employee={employee} open={editOpen} onOpenChange={setEditOpen} /> : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Pasar a {employee.name} a empleado?</DialogTitle>
            <DialogDescription>
              Dejará de ser administrador y perderá el acceso total. Quedará como empleado con los
              módulos básicos (Chats, Contactos y CRM); después podés ajustarle los módulos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <form action={clientDemoteAdminToEmployeeAction}>
              <input type="hidden" name="memberId" value={employee.id} />
              <Button type="submit">Pasar a empleado</Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmployeeActions({ employee }: { employee: EmployeeRow }) {
  const [editOpen, setEditOpen] = React.useState(false);
  const [promoteOpen, setPromoteOpen] = React.useState(false);

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

          <DropdownMenuItem onClick={() => setPromoteOpen(true)}>
            <ShieldCheck />
            Hacer administrador
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

      {/* Se monta al abrir: asi el formulario arranca siempre con lo guardado, no con lo de la vez anterior. */}
      {editOpen ? <EditarPersonaDialog employee={employee} open={editOpen} onOpenChange={setEditOpen} /> : null}

      {/* Confirmacion explicita: hacer administrador da acceso TOTAL (incluye el area de
          administracion), asi que no puede quedar a un clic distraido en un menu. */}
      <Dialog open={promoteOpen} onOpenChange={setPromoteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Hacer administrador a {employee.name}?</DialogTitle>
            <DialogDescription>
              Tendrá <strong>acceso total</strong>: todos los módulos del negocio y además el área de
              administración (catálogo, configuración, permisos y usuarios). Ya no se le gestionan
              módulos uno por uno. Podés revertirlo cuando quieras.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPromoteOpen(false)}>
              Cancelar
            </Button>
            <form action={clientPromoteEmployeeToAdminAction}>
              <input type="hidden" name="memberId" value={employee.id} />
              <Button type="submit">Sí, hacer administrador</Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChapaDeRol({ employee }: { employee: EmployeeRow }) {
  if (employee.role === "admin") {
    return <Badge variant="default">Administrador</Badge>;
  }
  if (employee.esSupervisora) {
    return (
      <Badge variant="outline" className="border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300">
        Supervisora
      </Badge>
    );
  }
  return <Badge variant="secondary">Asesora</Badge>;
}

function LineasDeLaPersona({ employee }: { employee: EmployeeRow }) {
  const suyas = employee.lineas.filter((linea) => linea.estado !== "no");
  if (suyas.length === 0) {
    return <span className="text-xs text-muted-foreground">Solo líneas abiertas</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {suyas.map((linea) => {
        const chapa = CHAPA_DE_LINEA[linea.estado as Exclude<EstadoDeLinea, "no">];
        return (
          <span
            key={linea.channelId}
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${chapa.clase}`}
          >
            {linea.nombre} · {chapa.texto}
          </span>
        );
      })}
    </div>
  );
}

function PantallasDeLaPersona({ employee }: { employee: EmployeeRow }) {
  if (employee.role === "admin") {
    return <span className="text-xs text-muted-foreground">Todas</span>;
  }
  if (employee.modules.length === 0) {
    return <span className="text-xs text-muted-foreground">Ninguna</span>;
  }
  const visibles = employee.modules.slice(0, 3);
  const resto = employee.modules.length - visibles.length;
  return (
    <div className="flex flex-wrap gap-1" title={employee.modules.map(etiquetaDeModulo).join(", ")}>
      {visibles.map((modulo) => (
        <Badge key={modulo} variant="secondary" className="font-normal">
          {etiquetaDeModulo(modulo)}
        </Badge>
      ))}
      {resto > 0 ? (
        <Badge variant="outline" className="font-normal">
          +{resto}
        </Badge>
      ) : null}
    </div>
  );
}

export function ClientTeamWorkspace({ employees }: ClientTeamWorkspaceProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Equipo</CardTitle>
        <CardDescription>
          Rol, líneas de WhatsApp y pantallas de cada persona. Todo se edita desde los tres puntos.
        </CardDescription>
        <CardAction>
          <InviteEmployeeDialog />
        </CardAction>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Persona</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Líneas</TableHead>
              <TableHead>Pantallas</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No hay nadie invitado todavía.
                </TableCell>
              </TableRow>
            ) : (
              employees.map((employee) => (
                <TableRow key={employee.id} className={employee.status === "inactive" ? "opacity-60" : undefined}>
                  <TableCell className="align-top">
                    <div className="flex min-w-44 flex-col gap-0.5">
                      <span className="flex items-center gap-2 font-medium">
                        {employee.name}
                        {employee.status !== "active" ? (
                          <EmployeeStatusBadge status={employee.status} label={employee.statusLabel} />
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{employee.email}</span>
                      {employee.status === "pending" ? (
                        <span className="text-[11px] text-muted-foreground">{employee.invitedAtLabel}</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <ChapaDeRol employee={employee} />
                  </TableCell>
                  <TableCell className="min-w-48 align-top">
                    <LineasDeLaPersona employee={employee} />
                  </TableCell>
                  <TableCell className="min-w-40 align-top">
                    <PantallasDeLaPersona employee={employee} />
                  </TableCell>
                  <TableCell className="align-top">
                    {employee.role === "admin" ? (
                      <AdminActions employee={employee} />
                    ) : (
                      <EmployeeActions employee={employee} />
                    )}
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
