"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addProductPlaybookRuleAction,
  deleteProductPlaybookRuleAction,
  saveProductPitchAction,
} from "@/app/actions/product-playbook-actions";
import type { ProductoV2PlaybookRule } from "../types";

/**
 * El playbook de ventas del producto: lo que la casa aprendio vendiendolo.
 *
 * Tres cosas separadas a proposito, porque son tres cosas distintas de corregir cuando se pierde
 * una venta: con que abrir, que hacer siempre, que no hacer nunca, y que contestar a cada
 * objecion. Un solo cuadro de texto largo se lee una vez y no se corrige mas.
 */

const GRUPOS = [
  {
    kind: "DECIR" as const,
    titulo: "Hacer siempre",
    ayuda: "Ej. confirmar el producto del anuncio antes de preguntar nada.",
    placeholder: "Qué tiene que hacer siempre…",
  },
  {
    kind: "NO_DECIR" as const,
    titulo: "Nunca hacer",
    ayuda: "Ej. no prometer fecha de entrega sin confirmar la ciudad.",
    placeholder: "Qué no puede hacer nunca…",
  },
];

export function ProductPlaybookEditor({
  productId,
  idealCustomer,
  customerPain,
  pitch,
  rules,
}: {
  productId: string;
  idealCustomer: string;
  customerPain: string;
  pitch: string;
  rules: ProductoV2PlaybookRule[];
}) {
  const router = useRouter();
  const [perfil, setPerfil] = useState(idealCustomer);
  const [dolor, setDolor] = useState(customerPain);
  const [texto, setTexto] = useState(pitch);
  const [guardadoPrevio, setGuardadoPrevio] = useState({
    perfil: idealCustomer,
    dolor: customerPain,
    pitch,
  });
  const [nuevaRegla, setNuevaRegla] = useState<Record<string, string>>({});
  const [objecion, setObjecion] = useState({ trigger: "", text: "" });
  const [ocupado, setOcupado] = useState(false);

  const objeciones = rules.filter((rule) => rule.kind === "OBJECION");
  const beneficios = rules.filter((rule) => rule.kind === "BENEFICIO");
  const [beneficio, setBeneficio] = useState({ trigger: "", text: "" });

  const guardarPitch = async () => {
    setOcupado(true);
    try {
      const result = await saveProductPitchAction({
        productId,
        pitch: texto,
        idealCustomer: perfil,
        customerPain: dolor,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setGuardadoPrevio({ perfil, dolor, pitch: texto });
      toast.success("Guardado");
      router.refresh();
    } catch {
      toast.error("No se pudo guardar. Recargá la página e intentá de nuevo.");
    } finally {
      setOcupado(false);
    }
  };

  const agregar = async (kind: string, text: string, trigger?: string) => {
    if (!text.trim()) return;
    setOcupado(true);
    try {
      const result = await addProductPlaybookRuleAction({ productId, kind, text, trigger });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setNuevaRegla((actual) => ({ ...actual, [kind]: "" }));
      if (kind === "OBJECION") {
        setObjecion({ trigger: "", text: "" });
      }
      if (kind === "BENEFICIO") {
        setBeneficio({ trigger: "", text: "" });
      }
      router.refresh();
    } catch {
      toast.error("No se pudo guardar. Recargá la página e intentá de nuevo.");
    } finally {
      setOcupado(false);
    }
  };

  const borrar = async (ruleId: string) => {
    setOcupado(true);
    try {
      const result = await deleteProductPlaybookRuleAction({ ruleId });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    } catch {
      toast.error("No se pudo borrar. Recargá la página e intentá de nuevo.");
    } finally {
      setOcupado(false);
    }
  };

  const filaRegla = (rule: ProductoV2PlaybookRule, contenido: React.ReactNode) => (
    <li
      key={rule.id}
      className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
    >
      <span className="min-w-0">{contenido}</span>
      <span className="flex shrink-0 items-center gap-2">
        {rule.source === "auditoria" ? (
          <Badge variant="secondary" className="font-normal">
            de una venta perdida
          </Badge>
        ) : null}
        <button
          type="button"
          aria-label="Quitar"
          onClick={() => void borrar(rule.id)}
          disabled={ocupado}
          className="text-muted-foreground transition hover:text-foreground disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </span>
    </li>
  );

  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-sm">Playbook de ventas</CardTitle>
          <Badge variant="secondary" className="font-normal">
            Lo lee el agente
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="pv2-perfil">Cliente ideal</Label>
          <Textarea
            id="pv2-perfil"
            rows={3}
            value={perfil}
            onChange={(event) => setPerfil(event.target.value)}
            placeholder="Ej. dueñas de spa o salón que están montando o renovando, con local propio…"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pv2-dolor">Qué le duele</Label>
          <Textarea
            id="pv2-dolor"
            rows={3}
            value={dolor}
            onChange={(event) => setDolor(event.target.value)}
            placeholder="Ej. su local se ve improvisado al lado de la competencia y pierde clientas…"
          />
        </div>

        {/* Caracteristica → beneficio. Va antes del "como se vende" porque es la materia prima:
            sin esto el agente recita ficha tecnica y el cliente no ve por que le conviene. */}
        <div className="space-y-2">
          <Label>Características y para qué le sirven</Label>
          {beneficios.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Ej. espaldar reclinable → puede atender faciales y masajes sin comprar otra camilla.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {beneficios.map((rule) =>
                filaRegla(
                  rule,
                  <>
                    <b>{rule.trigger}</b> → {rule.text}
                  </>,
                ),
              )}
            </ul>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              className="w-full sm:max-w-[220px]"
              value={beneficio.trigger}
              onChange={(event) => setBeneficio((actual) => ({ ...actual, trigger: event.target.value }))}
              placeholder="Qué tiene…"
            />
            <Input
              className="w-full sm:flex-1"
              value={beneficio.text}
              onChange={(event) => setBeneficio((actual) => ({ ...actual, text: event.target.value }))}
              placeholder="Qué gana el cliente con eso…"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => void agregar("BENEFICIO", beneficio.text, beneficio.trigger)}
              disabled={ocupado}
            >
              <Plus className="h-4 w-4" />
              Agregar
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pv2-pitch">Cómo se vende</Label>
          <Textarea
            id="pv2-pitch"
            rows={4}
            value={texto}
            onChange={(event) => setTexto(event.target.value)}
            placeholder="Con qué abrir, qué mostrar primero, qué preguntar para avanzar…"
          />
          <div className="flex items-center gap-3">
            <Button type="button" size="sm" onClick={() => void guardarPitch()} disabled={ocupado}>
              Guardar
            </Button>
            {texto !== guardadoPrevio.pitch ||
            perfil !== guardadoPrevio.perfil ||
            dolor !== guardadoPrevio.dolor ? (
              <span className="text-xs text-amber-700 dark:text-amber-300">Sin guardar</span>
            ) : guardadoPrevio.pitch || guardadoPrevio.perfil || guardadoPrevio.dolor ? (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                Guardado
              </span>
            ) : null}
          </div>
        </div>

        {GRUPOS.map((grupo) => {
          const delGrupo = rules.filter((rule) => rule.kind === grupo.kind);
          return (
            <div key={grupo.kind} className="space-y-2">
              <Label>{grupo.titulo}</Label>
              {delGrupo.length === 0 ? (
                <p className="text-xs text-muted-foreground">{grupo.ayuda}</p>
              ) : (
                <ul className="space-y-1.5">{delGrupo.map((rule) => filaRegla(rule, rule.text))}</ul>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  className="w-full sm:flex-1"
                  value={nuevaRegla[grupo.kind] ?? ""}
                  onChange={(event) =>
                    setNuevaRegla((actual) => ({ ...actual, [grupo.kind]: event.target.value }))
                  }
                  placeholder={grupo.placeholder}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => void agregar(grupo.kind, nuevaRegla[grupo.kind] ?? "")}
                  disabled={ocupado}
                >
                  <Plus className="h-4 w-4" />
                  Agregar
                </Button>
              </div>
            </div>
          );
        })}

        <div className="space-y-2">
          <Label>Objeciones</Label>
          {objeciones.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Ej. dice «está caro» → recordarle que el combo trae 4 piezas y cuánto costarían por
              separado.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {objeciones.map((rule) =>
                filaRegla(
                  rule,
                  <>
                    <b>«{rule.trigger}»</b> → {rule.text}
                  </>,
                ),
              )}
            </ul>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              className="w-full sm:max-w-[200px]"
              value={objecion.trigger}
              onChange={(event) => setObjecion((actual) => ({ ...actual, trigger: event.target.value }))}
              placeholder="Dice…"
            />
            <Input
              className="w-full sm:flex-1"
              value={objecion.text}
              onChange={(event) => setObjecion((actual) => ({ ...actual, text: event.target.value }))}
              placeholder="Le contestás…"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => void agregar("OBJECION", objecion.text, objecion.trigger)}
              disabled={ocupado}
            >
              <Plus className="h-4 w-4" />
              Agregar
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
