"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MessageSquare, Package, Search, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

type Resultado = {
  id: string;
  tipo: "chat" | "contacto" | "producto";
  titulo: string;
  detalle: string;
  href: string;
};

const GRUPOS = {
  chat: { titulo: "Chats", Icono: MessageSquare },
  contacto: { titulo: "Contactos", Icono: UserRound },
  producto: { titulo: "Productos", Icono: Package },
} as const;

/**
 * Una sola busqueda para toda la app.
 *
 * Antes cada modulo tenia su caja y habia que estar parado en el correcto: el telefono de una
 * clienta vive a la vez en Chats, en Contactos y en el CRM, y para verlo habia que abrir los tres.
 *
 * Se abre con Ctrl+K (⌘K en Mac) o con la lupa del encabezado.
 */
export function BuscadorGlobal() {
  const router = useRouter();
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key.toLowerCase() === "k" && (evento.metaKey || evento.ctrlKey)) {
        evento.preventDefault();
        setAbierto((valor) => !valor);
      }
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, []);

  // Se pregunta al servidor 250ms despues de la ultima tecla, y se cancela lo anterior: sin esto
  // escribir "camilla" son siete consultas y la respuesta de "cam" puede llegar despues de la
  // de "camilla" y pisarla.
  useEffect(() => {
    const consulta = texto.trim();
    if (consulta.length < 2) {
      setResultados([]);
      setBuscando(false);
      return;
    }

    setBuscando(true);
    const temporizador = setTimeout(async () => {
      abortRef.current?.abort();
      const control = new AbortController();
      abortRef.current = control;
      try {
        const respuesta = await fetch(`/api/cliente/buscar?q=${encodeURIComponent(consulta)}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: control.signal,
        });
        const datos = (await respuesta.json()) as { ok?: boolean; resultados?: Resultado[] };
        if (datos.ok && Array.isArray(datos.resultados)) {
          setResultados(datos.resultados);
        }
      } catch {
        // Cancelada o sin red: se deja lo anterior en pantalla en vez de vaciarla de golpe.
      } finally {
        setBuscando(false);
      }
    }, 250);

    return () => clearTimeout(temporizador);
  }, [texto]);

  /**
   * El modulo donde estas parado va primero.
   *
   * Buscar "camilla" desde Chats casi siempre es buscar una conversacion; el mismo texto desde
   * Productos es buscar el producto. Es la misma busqueda, ordenada por donde estas.
   */
  const ordenDeGrupos: Array<Resultado["tipo"]> = pathname.startsWith("/cliente/productos")
    ? ["producto", "chat", "contacto"]
    : pathname.startsWith("/cliente/contactos") || pathname.startsWith("/cliente/crm")
      ? ["contacto", "chat", "producto"]
      : ["chat", "contacto", "producto"];

  const elegir = useCallback(
    (href: string) => {
      setAbierto(false);
      setTexto("");
      router.push(href);
    },
    [router],
  );

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Buscar en todo (Ctrl+K)"
        title="Buscar en todo (Ctrl+K)"
        onClick={() => setAbierto(true)}
      >
        <Search data-icon="inline-start" />
      </Button>

      <CommandDialog
        open={abierto}
        onOpenChange={setAbierto}
        label="Buscar en todo"
        shouldFilter={false}
      >
        <CommandInput
          placeholder="Buscar chats, contactos, productos..."
          value={texto}
          onValueChange={setTexto}
        />
        <CommandList>
          <CommandEmpty>
            {texto.trim().length < 2
              ? "Escribe al menos dos letras."
              : buscando
                ? "Buscando..."
                : "No encontramos nada con eso."}
          </CommandEmpty>

          {ordenDeGrupos.map((tipo) => {
            const delGrupo = resultados.filter((resultado) => resultado.tipo === tipo);
            if (delGrupo.length === 0) {
              return null;
            }
            const { titulo, Icono } = GRUPOS[tipo];
            return (
              <CommandGroup key={tipo} heading={titulo}>
                {delGrupo.map((resultado) => (
                  <CommandItem
                    key={resultado.id}
                    value={resultado.id}
                    onSelect={() => elegir(resultado.href)}
                  >
                    <Icono className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{resultado.titulo}</span>
                    <span className="truncate text-xs text-muted-foreground">{resultado.detalle}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
        </CommandList>
      </CommandDialog>
    </>
  );
}
