"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveProductMatchAction } from "@/app/actions/product-playbook-actions";

/**
 * Como se reconoce este producto en una conversacion.
 *
 * Antes esto dependia de que el agente hubiera marcado el producto al responder. Medido contra
 * produccion, eso dejaba afuera casi la mitad de las conversaciones: las que atiende una persona
 * —con la IA en pausa el agente nunca corre— y son justo las mas avanzadas.
 *
 * Con esto el producto se reconoce solo, aunque el agente no haya intervenido nunca.
 */
export function ProductMatchForm({
  productId,
  keywords,
  adTitles,
}: {
  productId: string;
  keywords: string[];
  adTitles: string[];
}) {
  const router = useRouter();
  const [palabras, setPalabras] = useState(() => keywords.join(", "));
  const [anuncios, setAnuncios] = useState(() => adTitles.join(", "));
  const [guardado, setGuardado] = useState(() => ({
    palabras: keywords.join(", "),
    anuncios: adTitles.join(", "),
  }));
  const [ocupado, setOcupado] = useState(false);

  const hayCambios = palabras !== guardado.palabras || anuncios !== guardado.anuncios;

  const partir = (valor: string) =>
    valor
      .split(",")
      .map((parte) => parte.trim())
      .filter(Boolean);

  const guardar = async () => {
    setOcupado(true);
    try {
      const result = await saveProductMatchAction({
        productId,
        keywords: partir(palabras),
        adTitles: partir(anuncios),
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setGuardado({ palabras, anuncios });
      toast.success("Regla guardada");
      router.refresh();
    } catch {
      toast.error("No se pudo guardar. Recargá la página e intentá de nuevo.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="text-sm">Cómo se reconoce</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="pv2-palabras">Si el cliente dice</Label>
          <Input
            id="pv2-palabras"
            value={palabras}
            onChange={(event) => setPalabras(event.target.value)}
            placeholder="camilla, combo"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pv2-anuncios">O si vino de estos anuncios</Label>
          <Input
            id="pv2-anuncios"
            value={anuncios}
            onChange={(event) => setAnuncios(event.target.value)}
            placeholder="Combo Completo para Estéticas, Camillas Contra entrega"
          />
          <p className="text-[11px] text-muted-foreground">
            Separados por comas. Alcanza con una parte del título. No distingue mayúsculas ni
            tildes.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" size="sm" onClick={() => void guardar()} disabled={ocupado}>
            {ocupado ? "Guardando…" : "Guardar regla"}
          </Button>
          {hayCambios ? (
            <span className="text-xs text-amber-700 dark:text-amber-300">Sin guardar</span>
          ) : guardado.palabras || guardado.anuncios ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              Guardada
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
