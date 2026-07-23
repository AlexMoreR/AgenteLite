"use client";

import { useState } from "react";
import type { ProductoV2Flow, ProductoV2Item } from "../types";

function formatPrice(price: number | null): string {
  if (!price || price <= 0) return "";
  return `$ ${price.toLocaleString("es-CO")}`;
}

export function ProductoV2Workspace({
  products,
  allFlows,
}: {
  products: ProductoV2Item[];
  allFlows: ProductoV2Flow[];
}) {
  const [selectedId, setSelectedId] = useState<string>(products[0]?.id ?? "");
  const selected = products.find((product) => product.id === selectedId) ?? products[0] ?? null;

  return (
    <div className="pv2-root">
      <style>{PV2_STYLES}</style>

      <div className="pv2-crumb">
        Aizenbot · <b>Producto V2</b>
      </div>
      <div className="pv2-title-row">
        <h1 className="pv2-h1">{selected ? selected.name : "Productos"}</h1>
        <span className="pv2-badge">Vista previa · guardar próximamente</span>
      </div>
      <p className="pv2-intro">
        Un producto es un contenedor: le anclás flujos y decís cuándo corre cada uno. El precio es
        opcional. Esta primera versión muestra tus productos reales; la edición y el guardado llegan
        en el siguiente paso.
      </p>

      {products.length === 0 ? (
        <div className="pv2-empty">
          Todavía no hay productos. Se crearán acá cuando esté lista la edición.
        </div>
      ) : (
        <>
          <div className="pv2-tabs">
            {products.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => setSelectedId(product.id)}
                className={`pv2-tab ${product.id === selectedId ? "on" : ""} ${product.sells ? "sell" : "cat"}`}
              >
                <span className="pv2-dot" />
                {product.name}
              </button>
            ))}
            <span className="pv2-tab add" aria-disabled="true">+ Nuevo producto</span>
          </div>

          {selected ? (
            <div className="pv2-card">
              {/* Identidad */}
              <div className="pv2-sec">
                <div className="pv2-sec-h">
                  <span className="pv2-k">Identidad</span>
                  <span className="pv2-req">Obligatorio</span>
                </div>
                <label className="pv2-f">Nombre del producto</label>
                <input className="pv2-inp big" value={selected.name} readOnly />
                <div className="pv2-mt14">
                  <label className="pv2-f">
                    Palabra distintiva <span className="pv2-faint">(la usa el candado para no confundirlo)</span>
                  </label>
                  <span className="pv2-chip-dist"># {selected.distinctiveWord}</span>
                  <p className="pv2-hint">Se saca del nombre. Es lo que separa este producto de los demás.</p>
                </div>
              </div>

              {/* Tipo */}
              <div className="pv2-sec">
                <div className="pv2-sec-h">
                  <span className="pv2-k">Tipo</span>
                </div>
                <div className="pv2-segs">
                  <div className={`pv2-seg ${selected.sells ? "on" : ""}`}>
                    <div className="pv2-st">🛒 Vende <span className="pv2-rd" /></div>
                    <div className="pv2-sd">Tiene precio y cierre. Es lo que se ancla desde el anuncio.</div>
                  </div>
                  <div className={`pv2-seg ${selected.sells ? "" : "on"}`}>
                    <div className="pv2-st">📄 Solo catálogo <span className="pv2-rd" /></div>
                    <div className="pv2-sd">Solo muestra opciones, sin precio.</div>
                  </div>
                </div>
              </div>

              {/* Flujos anclados */}
              <div className="pv2-sec">
                <div className="pv2-sec-h">
                  <span className="pv2-k">Flujos anclados</span>
                  <span className="pv2-req">Obligatorio</span>
                </div>
                <div className="pv2-flows">
                  {selected.anchoredFlowTitle ? (
                    <div className="pv2-flow">
                      <div className="pv2-ic">📎</div>
                      <div>
                        <div className="pv2-nm">{selected.anchoredFlowTitle}</div>
                        <div className="pv2-when">
                          se ejecuta <span className="pv2-cond">cuando el cliente lo pide</span>
                        </div>
                      </div>
                      <div className="pv2-grip">⋮⋮</div>
                    </div>
                  ) : (
                    <div className="pv2-flow-empty">Este producto todavía no tiene un flujo anclado.</div>
                  )}
                  <div className="pv2-add-flow" aria-disabled="true">
                    + Anclar un flujo · y elegir cuándo se ejecuta
                  </div>
                </div>
                <p className="pv2-hint">
                  Hay {allFlows.length} flujos disponibles para anclar. Un mismo flujo se puede anclar a
                  varios productos — así se comparte.
                </p>
              </div>

              {/* Precio */}
              <div className="pv2-sec">
                <div className="pv2-sec-h">
                  <span className="pv2-k">Precio y cierre</span>
                  <span className="pv2-req opt">Opcional · solo si vende</span>
                </div>
                {selected.sells ? (
                  <>
                    <label className="pv2-f">Precio</label>
                    <input className="pv2-inp" value={formatPrice(selected.price)} readOnly />
                  </>
                ) : (
                  <p className="pv2-disabled">Este producto es "solo catálogo" — no tiene precio.</p>
                )}
              </div>

              {/* Anuncios */}
              <div className="pv2-sec">
                <div className="pv2-sec-h">
                  <span className="pv2-k">Anuncios que traen a este producto</span>
                  <span className="pv2-req opt">Opcional</span>
                </div>
                <p className="pv2-disabled">
                  Todavía no configurados. Acá vas a listar los anuncios de Meta que traen a este
                  producto, para que el lead quede anclado desde el primer mensaje.
                </p>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

const PV2_STYLES = `
.pv2-root { --pv2-surface:#fff; --pv2-surface2:#f8f9fc; --pv2-ink:#1b1e29; --pv2-muted:#6b7280;
  --pv2-faint:#9aa1ad; --pv2-hair:#e7e9ef; --pv2-hair2:#dfe2ea; --pv2-accent:#5b52e0; --pv2-accent-ink:#4a41c8;
  --pv2-accent-soft:#edecfc; --pv2-green:#12805c; --pv2-amber:#9a6410; --pv2-amber-soft:#f6ebd7;
  --pv2-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  max-width:880px; margin:0 auto; padding:8px 2px 60px; color:var(--pv2-ink);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; line-height:1.5; }
@media (prefers-color-scheme:dark){ .pv2-root { --pv2-surface:#181b22; --pv2-surface2:#1e222b; --pv2-ink:#e9ebf0;
  --pv2-muted:#9aa2b1; --pv2-faint:#6d7583; --pv2-hair:#282d37; --pv2-hair2:#333a46; --pv2-accent:#8078f0;
  --pv2-accent-ink:#a49ef6; --pv2-accent-soft:#20203a; --pv2-green:#4cbd8e; --pv2-amber:#d29a4e; --pv2-amber-soft:#2f2611; } }
.pv2-root *{ box-sizing:border-box; }
.pv2-crumb{ font-family:var(--pv2-mono); font-size:12px; color:var(--pv2-faint); }
.pv2-crumb b{ color:var(--pv2-accent); }
.pv2-title-row{ display:flex; align-items:center; gap:12px; margin-top:8px; flex-wrap:wrap; }
.pv2-h1{ font-size:clamp(21px,4vw,27px); letter-spacing:-.02em; margin:0; font-weight:750; }
.pv2-badge{ font-family:var(--pv2-mono); font-size:10.5px; letter-spacing:.06em; text-transform:uppercase;
  color:var(--pv2-accent-ink); background:var(--pv2-accent-soft); padding:3px 9px; border-radius:20px; font-weight:600; }
.pv2-intro{ color:var(--pv2-muted); font-size:14px; margin:10px 0 0; max-width:62ch; }
.pv2-empty{ margin-top:22px; padding:28px; text-align:center; color:var(--pv2-muted); background:var(--pv2-surface2);
  border:1px solid var(--pv2-hair); border-radius:14px; }
.pv2-tabs{ display:flex; gap:8px; margin-top:22px; flex-wrap:wrap; }
.pv2-tab{ font-size:13.5px; padding:8px 14px; border-radius:10px; border:1px solid var(--pv2-hair2);
  background:var(--pv2-surface); color:var(--pv2-muted); cursor:pointer; display:inline-flex; align-items:center; gap:7px;
  font-family:inherit; }
.pv2-tab .pv2-dot{ width:7px; height:7px; border-radius:50%; background:var(--pv2-faint); }
.pv2-tab.sell .pv2-dot{ background:var(--pv2-green); }
.pv2-tab.cat .pv2-dot{ background:var(--pv2-amber); }
.pv2-tab.on{ background:var(--pv2-accent); border-color:var(--pv2-accent); color:#fff; font-weight:600; }
.pv2-tab.on .pv2-dot{ background:#fff; }
.pv2-tab.add{ border-style:dashed; color:var(--pv2-accent); cursor:default; }
.pv2-card{ background:var(--pv2-surface); border:1px solid var(--pv2-hair); border-radius:16px; margin-top:16px;
  overflow:hidden; box-shadow:0 14px 32px -22px rgba(20,24,40,.3); }
.pv2-sec{ padding:20px 22px; border-top:1px solid var(--pv2-hair); }
.pv2-sec:first-child{ border-top:none; }
.pv2-sec-h{ display:flex; align-items:center; gap:9px; margin-bottom:14px; }
.pv2-k{ font-family:var(--pv2-mono); font-size:11px; letter-spacing:.09em; text-transform:uppercase; color:var(--pv2-faint); font-weight:600; }
.pv2-req{ font-family:var(--pv2-mono); font-size:10px; letter-spacing:.05em; text-transform:uppercase; color:var(--pv2-muted);
  background:var(--pv2-surface2); border:1px solid var(--pv2-hair); padding:2px 7px; border-radius:20px; margin-left:auto; }
.pv2-req.opt{ color:var(--pv2-amber); background:var(--pv2-amber-soft); border-color:transparent; }
.pv2-f{ display:block; font-size:12px; font-weight:600; color:var(--pv2-muted); margin:0 0 6px; }
.pv2-faint{ font-weight:400; color:var(--pv2-faint); }
.pv2-inp{ width:100%; height:42px; border:1px solid var(--pv2-hair2); border-radius:11px; background:var(--pv2-surface2);
  padding:0 13px; font-size:15px; color:var(--pv2-ink); font-family:inherit; }
.pv2-inp.big{ font-size:17px; font-weight:600; }
.pv2-mt14{ margin-top:14px; }
.pv2-hint{ font-size:12.5px; color:var(--pv2-faint); margin:7px 0 0; }
.pv2-chip-dist{ display:inline-flex; align-items:center; gap:6px; font-family:var(--pv2-mono); font-size:12.5px;
  background:var(--pv2-accent-soft); color:var(--pv2-accent-ink); border:1px solid color-mix(in srgb,var(--pv2-accent) 22%,transparent);
  padding:5px 10px; border-radius:8px; font-weight:600; }
.pv2-segs{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
@media (max-width:520px){ .pv2-segs{ grid-template-columns:1fr; } }
.pv2-seg{ border:1.5px solid var(--pv2-hair2); border-radius:12px; padding:13px 15px; background:var(--pv2-surface2); }
.pv2-seg.on{ border-color:var(--pv2-accent); background:var(--pv2-accent-soft); }
.pv2-st{ font-weight:650; font-size:14.5px; display:flex; align-items:center; gap:8px; }
.pv2-sd{ font-size:12.5px; color:var(--pv2-muted); margin-top:4px; }
.pv2-rd{ margin-left:auto; width:16px; height:16px; border-radius:50%; border:2px solid var(--pv2-hair2); }
.pv2-seg.on .pv2-rd{ border-color:var(--pv2-accent); background:radial-gradient(circle at center, var(--pv2-accent) 0 4px, transparent 5px); }
.pv2-flows{ display:flex; flex-direction:column; gap:10px; }
.pv2-flow{ display:grid; grid-template-columns:auto 1fr auto; gap:13px; align-items:center; border:1px solid var(--pv2-hair2);
  border-radius:12px; padding:12px 14px; background:var(--pv2-surface2); }
.pv2-ic{ width:38px; height:38px; border-radius:10px; background:var(--pv2-accent-soft); color:var(--pv2-accent-ink);
  display:flex; align-items:center; justify-content:center; font-size:18px; }
.pv2-nm{ font-weight:600; font-size:14.5px; }
.pv2-when{ font-size:12.5px; color:var(--pv2-muted); margin-top:3px; }
.pv2-cond{ font-family:var(--pv2-mono); font-size:11.5px; background:var(--pv2-surface); border:1px solid var(--pv2-hair2);
  padding:2px 7px; border-radius:6px; color:var(--pv2-ink); }
.pv2-grip{ color:var(--pv2-faint); font-size:18px; letter-spacing:-2px; }
.pv2-flow-empty{ font-size:13.5px; color:var(--pv2-muted); padding:8px 2px; }
.pv2-add-flow{ border:1.5px dashed var(--pv2-hair2); border-radius:12px; padding:12px; text-align:center; color:var(--pv2-accent);
  font-size:13.5px; font-weight:600; }
.pv2-disabled{ font-size:13px; color:var(--pv2-faint); font-style:italic; margin:0; }
`;
