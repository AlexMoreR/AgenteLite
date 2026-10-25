"use client";

import { useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { crearTableroAction, renombrarTableroAction } from "@/app/actions/tableros-inteligentes-actions";
import { MAX_NOMBRE_TABLERO, problemaDelNombreDeTablero, type MiembroDelNegocio } from "../services/reglas";

/*
  El diálogo de "Cambiar nombre" y "+ Nuevo tablero" (Enter guarda, Esc cancela). Lo usan el selector
  de la barra (en el diagrama) y la página de inicio. El servidor vuelve a revisar el permiso y el
  nombre; acá se revisa antes para avisar sin esperar.

  Tableros por cuenta: cualquiera crea y renombra los suyos. El dueño del negocio (o el ADMIN) además
  elige "De quién es" entre los miembros activos (así arma "Desarrollo Emanuel" y se lo da a Emanuel).
*/

/** La página de inicio (el listado). Igual que RUTA_TABLEROS del servicio, que no se importa acá porque trae Prisma. */
export const RUTA_DEL_INICIO = "/cliente/tablero-ia";

/** El diagrama de un tablero. */
export const linkDelTableroEnPantalla = (id: string) => `${RUTA_DEL_INICIO}?tablero=${encodeURIComponent(id)}`;
export const linkDeLaTarjetaEnPantalla = (id: string) => `${RUTA_DEL_INICIO}?tarjeta=${encodeURIComponent(id)}`;

/** Lo que edita el diálogo: un tablero que se renombra, o uno nuevo. */
export type EdicionDeTablero =
  | { modo: "renombrar"; id: string; nombre: string; duenoUserId: string | null; duenoNombre: string | null }
  | { modo: "crear" };

/**
 * Tableros por cuenta: quién mira (`yo`), si ve todos los tableros (el dueño del negocio o el ADMIN) y
 * a quién le puede dar uno (los miembros activos; vacío si no ve todos).
 */
export type CuentasDeTableros = { yo: string; verTodos: boolean; miembros: MiembroDelNegocio[] };

export type DuenoDeTablero = { duenoUserId: string | null; duenoNombre: string | null };

/** Quién puede tocar el lápiz de un tablero: su dueño, o quien ve todos. */
export const puedeRenombrar = (cuentas: CuentasDeTableros, tablero: DuenoDeTablero) =>
  cuentas.verTodos || tablero.duenoUserId === cuentas.yo;

/** La etiqueta "de Emanuel Diaz" de un tablero que no es de quien mira (null si es suyo). */
export function etiquetaDelDueno(cuentas: CuentasDeTableros, tablero: DuenoDeTablero) {
  if (tablero.duenoUserId === cuentas.yo) return null;
  return tablero.duenoNombre ? `de ${tablero.duenoNombre}` : "sin dueño";
}

type Props = {
  edicion: EdicionDeTablero | null;
  /** Los tableros que se ven, para avisar un nombre repetido (el servidor revisa todos los del negocio). */
  tableros: { id: string; nombre: string }[];
  cuentas: CuentasDeTableros;
  alCerrar: () => void;
  /** `dueno` viene solo si cambió de quién es. */
  alRenombrar: (id: string, nombre: string, dueno?: DuenoDeTablero) => void;
  alCrear: (id: string) => void;
};

export function DialogoDeTablero(props: Props) {
  return (
    <Dialog
      open={props.edicion !== null}
      onOpenChange={(abrir) => {
        if (!abrir) props.alCerrar();
      }}
    >
      {/* Con key: cada vez que se abre arranca con el nombre de ese tablero y sin error. */}
      {props.edicion ? (
        <Formulario key={props.edicion.modo === "renombrar" ? props.edicion.id : "nuevo"} {...props} edicion={props.edicion} />
      ) : null}
    </Dialog>
  );
}

function Formulario({ edicion, tableros, cuentas, alCerrar, alRenombrar, alCrear }: Props & { edicion: EdicionDeTablero }) {
  const [nombre, setNombre] = useState(edicion.modo === "renombrar" ? edicion.nombre : "");
  // De quién es: al crear, de quien lo crea; al renombrar, el que tiene ("" = sin dueño).
  const duenoInicial = edicion.modo === "renombrar" ? (edicion.duenoUserId ?? "") : cuentas.yo;
  const [dueno, setDueno] = useState(duenoInicial);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  // Elegir el dueño: solo quien ve todos (el dueño del negocio o el ADMIN), entre los miembros activos.
  const eligeDueno = cuentas.verTodos && cuentas.miembros.length > 0;
  const opciones = [...cuentas.miembros.map((miembro) => ({ valor: miembro.userId, texto: miembro.nombre }))];
  if (!opciones.some((opcion) => opcion.valor === duenoInicial)) {
    // El dueño de hoy no está entre los miembros (el ADMIN, alguien que salió, o nadie): igual se muestra.
    const texto =
      duenoInicial === cuentas.yo
        ? "Tú"
        : edicion.modo === "renombrar" && edicion.duenoNombre
          ? edicion.duenoNombre
          : "Sin dueño";
    opciones.unshift({ valor: duenoInicial, texto });
  }
  const duenoElegido = eligeDueno && dueno && dueno !== duenoInicial ? dueno : undefined;

  const cerrar = () => {
    if (!guardando) alCerrar();
  };

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (guardando) return;
    const limpio = nombre.trim();
    const salvo = edicion.modo === "renombrar" ? edicion.id : null;
    const problema = problemaDelNombreDeTablero(limpio, tableros, salvo);
    if (problema) {
      setError(problema);
      return;
    }
    if (edicion.modo === "renombrar" && limpio === edicion.nombre && !duenoElegido) {
      alCerrar();
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      if (edicion.modo === "renombrar") {
        const resultado = await renombrarTableroAction(edicion.id, limpio, duenoElegido);
        if (!resultado.ok) {
          setError(resultado.error);
          return;
        }
        alRenombrar(
          edicion.id,
          limpio,
          duenoElegido
            ? { duenoUserId: duenoElegido, duenoNombre: opciones.find((opcion) => opcion.valor === duenoElegido)?.texto ?? null }
            : undefined,
        );
      } else {
        const resultado = await crearTableroAction(limpio, duenoElegido);
        if (!resultado.ok) {
          setError(resultado.error);
          return;
        }
        alCrear(resultado.id);
      }
    } catch {
      setError("No se pudo guardar. Revisa la conexión e intenta de nuevo.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <DialogContent initialFocus={campo}>
      <form onSubmit={guardar} className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{edicion.modo === "crear" ? "Nuevo tablero" : "Cambiar nombre"}</DialogTitle>
          <DialogDescription>
            {edicion.modo === "crear"
              ? "Nace con los tipos Área, Idea y Tarea."
              : eligeDueno
                ? "Las tarjetas no cambian: solo el nombre del tablero y de quién es."
                : "Las tarjetas no cambian: solo el nombre del tablero."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Input
            ref={campo}
            value={nombre}
            onChange={(evento) => {
              setNombre(evento.target.value);
              setError(null);
            }}
            maxLength={MAX_NOMBRE_TABLERO}
            placeholder="Ventas"
            aria-label="Nombre del tablero"
            aria-invalid={error ? true : undefined}
            enterKeyHint="done"
            autoComplete="off"
            className="h-11 text-base md:h-9 md:text-sm"
            disabled={guardando}
          />
          <div className="flex justify-between gap-2 text-xs">
            <span className="text-destructive" role={error ? "alert" : undefined}>
              {error}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {nombre.trim().length}/{MAX_NOMBRE_TABLERO}
            </span>
          </div>
        </div>
        {eligeDueno ? (
          <div className="grid gap-1.5">
            <label htmlFor="dueno-del-tablero" className="text-sm font-medium">
              De quién es
            </label>
            <NativeSelect
              id="dueno-del-tablero"
              value={dueno}
              onChange={(evento) => {
                setDueno(evento.target.value);
                setError(null);
              }}
              disabled={guardando}
              className="w-full [&_select]:h-11 [&_select]:text-base md:[&_select]:h-9 md:[&_select]:text-sm"
            >
              {opciones.map((opcion) => (
                <NativeSelectOption key={opcion.valor || "sin-dueno"} value={opcion.valor} disabled={!opcion.valor}>
                  {opcion.texto}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">Esa persona lo ve y lo renombra. Tú sigues viendo todos.</p>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11 md:h-9" onClick={cerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="submit" className="h-11 md:h-9" disabled={guardando}>
            {guardando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {edicion.modo === "crear" ? "Crear" : "Guardar"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
