"use client";

import { useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { crearTableroAction, renombrarTableroAction } from "@/app/actions/tableros-inteligentes-actions";
import { MAX_NOMBRE_TABLERO, problemaDelNombreDeTablero } from "../services/reglas";

/*
  El diálogo de "Cambiar nombre" y "+ Nuevo tablero" (Enter guarda, Esc cancela). Lo usan el selector
  de la barra (en el diagrama) y la página de inicio. El servidor vuelve a revisar el permiso y el
  nombre; acá se revisa antes para avisar sin esperar.
*/

/** La página de inicio (el listado). Igual que RUTA_TABLEROS del servicio, que no se importa acá porque trae Prisma. */
export const RUTA_DEL_INICIO = "/cliente/tablero-ia";

/** El diagrama de un tablero. */
export const linkDelTableroEnPantalla = (id: string) => `${RUTA_DEL_INICIO}?tablero=${encodeURIComponent(id)}`;

/** Lo que edita el diálogo: un tablero que se renombra, o uno nuevo. */
export type EdicionDeTablero = { modo: "renombrar"; id: string; nombre: string } | { modo: "crear" };

type Props = {
  edicion: EdicionDeTablero | null;
  /** Los tableros del negocio, para avisar un nombre repetido. */
  tableros: { id: string; nombre: string }[];
  alCerrar: () => void;
  alRenombrar: (id: string, nombre: string) => void;
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

function Formulario({ edicion, tableros, alCerrar, alRenombrar, alCrear }: Props & { edicion: EdicionDeTablero }) {
  const [nombre, setNombre] = useState(edicion.modo === "renombrar" ? edicion.nombre : "");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

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
    if (edicion.modo === "renombrar" && limpio === edicion.nombre) {
      alCerrar();
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      if (edicion.modo === "renombrar") {
        const resultado = await renombrarTableroAction(edicion.id, limpio);
        if (!resultado.ok) {
          setError(resultado.error);
          return;
        }
        alRenombrar(edicion.id, limpio);
      } else {
        const resultado = await crearTableroAction(limpio);
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
            {edicion.modo === "crear" ? "Nace con los tipos Área, Idea y Tarea." : "Las tarjetas no cambian: solo el nombre del tablero."}
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
