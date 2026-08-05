"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

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
    ayuda: "Ej. Confirmar el producto del anuncio antes de preguntar nada.",
    placeholder: "Qué tiene que hacer siempre…",
  },
  {
    kind: "NO_DECIR" as const,
    titulo: "Nunca hacer",
    ayuda: "Ej. No prometer fecha de entrega sin confirmar la ciudad.",
    placeholder: "Qué no puede hacer nunca…",
  },
];

export function ProductPlaybookEditor({
  productId,
  productName,
  pitch,
  rules,
}: {
  productId: string;
  productName: string;
  pitch: string;
  rules: ProductoV2PlaybookRule[];
}) {
  const router = useRouter();
  const [texto, setTexto] = useState(pitch);
  const [pitchGuardado, setPitchGuardado] = useState(pitch);
  const [nuevaRegla, setNuevaRegla] = useState<Record<string, string>>({});
  const [objecion, setObjecion] = useState({ trigger: "", text: "" });
  const [ocupado, setOcupado] = useState(false);

  const objeciones = rules.filter((rule) => rule.kind === "OBJECION");

  const guardarPitch = async () => {
    setOcupado(true);
    try {
      const result = await saveProductPitchAction({ productId, pitch: texto });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setPitchGuardado(texto);
      toast.success("Guardado");
      router.refresh();
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
      router.refresh();
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
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="pv2-sec">
      <div className="pv2-sec-h">
        <span className="pv2-k">Playbook de ventas</span>
        <span className="pv2-req opt">Lo lee el agente</span>
      </div>

      <p className="pv2-hint" style={{ marginTop: 0 }}>
        Lo que aprendiste vendiendo <b>{productName}</b>. El agente lo aplica en la próxima
        respuesta: no hace falta volver a publicarlo.
      </p>

      <label className="pv2-f">Cómo se vende</label>
      <textarea
        className="pv2-inp pv2-ta"
        rows={4}
        value={texto}
        onChange={(event) => setTexto(event.target.value)}
        placeholder="Con qué abrir, qué mostrar primero, qué preguntar para avanzar…"
      />
      <div className="pv2-row-btns">
        <button type="button" className="pv2-btn" onClick={() => void guardarPitch()} disabled={ocupado}>
          Guardar
        </button>
        {texto === pitchGuardado ? (
          <span className="pv2-ok">✓ Guardado</span>
        ) : (
          <span className="pv2-warn">Sin guardar</span>
        )}
      </div>

      {GRUPOS.map((grupo) => {
        const delGrupo = rules.filter((rule) => rule.kind === grupo.kind);
        return (
          <div key={grupo.kind} className="pv2-mt14">
            <label className="pv2-f">{grupo.titulo}</label>
            {delGrupo.length === 0 ? (
              <p className="pv2-disabled" style={{ margin: "4px 0 8px" }}>
                {grupo.ayuda}
              </p>
            ) : (
              <ul className="pv2-rules">
                {delGrupo.map((rule) => (
                  <li key={rule.id} className="pv2-rule">
                    <span>{rule.text}</span>
                    <span className="pv2-rule-meta">
                      {rule.source === "auditoria" ? <em>de una venta perdida</em> : null}
                      <button
                        type="button"
                        aria-label="Quitar regla"
                        onClick={() => void borrar(rule.id)}
                        disabled={ocupado}
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="pv2-row-btns">
              <input
                className="pv2-inp"
                value={nuevaRegla[grupo.kind] ?? ""}
                onChange={(event) =>
                  setNuevaRegla((actual) => ({ ...actual, [grupo.kind]: event.target.value }))
                }
                placeholder={grupo.placeholder}
              />
              <button
                type="button"
                className="pv2-btn ghost"
                onClick={() => void agregar(grupo.kind, nuevaRegla[grupo.kind] ?? "")}
                disabled={ocupado}
              >
                Agregar
              </button>
            </div>
          </div>
        );
      })}

      <div className="pv2-mt14">
        <label className="pv2-f">
          Objeciones <span className="pv2-faint">(lo que dice el cliente y qué contestarle)</span>
        </label>
        {objeciones.length === 0 ? (
          <p className="pv2-disabled" style={{ margin: "4px 0 8px" }}>
            Ej. dice «está caro» → recordarle que el combo trae 4 piezas y el precio por separado.
          </p>
        ) : (
          <ul className="pv2-rules">
            {objeciones.map((rule) => (
              <li key={rule.id} className="pv2-rule">
                <span>
                  <b>«{rule.trigger}»</b> → {rule.text}
                </span>
                <span className="pv2-rule-meta">
                  {rule.source === "auditoria" ? <em>de una venta perdida</em> : null}
                  <button
                    type="button"
                    aria-label="Quitar objeción"
                    onClick={() => void borrar(rule.id)}
                    disabled={ocupado}
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="pv2-row-btns">
          <input
            className="pv2-inp"
            style={{ maxWidth: 200 }}
            value={objecion.trigger}
            onChange={(event) => setObjecion((actual) => ({ ...actual, trigger: event.target.value }))}
            placeholder="Dice…"
          />
          <input
            className="pv2-inp"
            value={objecion.text}
            onChange={(event) => setObjecion((actual) => ({ ...actual, text: event.target.value }))}
            placeholder="Le contestás…"
          />
          <button
            type="button"
            className="pv2-btn ghost"
            onClick={() => void agregar("OBJECION", objecion.text, objecion.trigger)}
            disabled={ocupado}
          >
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
}
