"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  addProductPlaybookRuleAction,
  deleteProductPlaybookRuleAction,
} from "@/app/actions/product-playbook-actions";
import type { ProductoV2PlaybookRule } from "../types";

/**
 * Lo que dice el cliente para no comprar, y que contestarle.
 *
 * Va aparte del resto del playbook porque es lo que mas crece: el playbook se escribe una vez y
 * se retoca, las objeciones se suman cada vez que alguien dice algo nuevo. Mezcladas, esta lista
 * empujaba todo lo demas fuera de la pantalla.
 */
export function ProductObjectionsEditor({
  productId,
  rules,
}: {
  productId: string;
  rules: ProductoV2PlaybookRule[];
}) {
  const router = useRouter();
  const [objecion, setObjecion] = useState({ trigger: "", text: "" });
  const [ocupado, setOcupado] = useState(false);

  const objeciones = rules.filter((rule) => rule.kind === "OBJECION");

  const agregar = async () => {
    if (!objecion.text.trim()) return;
    setOcupado(true);
    try {
      const result = await addProductPlaybookRuleAction({
        productId,
        kind: "OBJECION",
        text: objecion.text,
        trigger: objecion.trigger,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setObjecion({ trigger: "", text: "" });
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

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="text-sm">Objeciones</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {objeciones.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Ej. dice «está caro» → recordarle que el combo trae 4 piezas y cuánto costarían por
            separado.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {objeciones.map((rule) => (
              <li
                key={rule.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span className="min-w-0">
                  <b>«{rule.trigger}»</b> → {rule.text}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {rule.source === "auditoria" ? (
                    <Badge variant="secondary" className="font-normal">
                      de una venta perdida
                    </Badge>
                  ) : null}
                  <button
                    type="button"
                    aria-label="Quitar objeción"
                    onClick={() => void borrar(rule.id)}
                    disabled={ocupado}
                    className="text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
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
            onClick={() => void agregar()}
            disabled={ocupado}
          >
            <Plus className="h-4 w-4" />
            Agregar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
