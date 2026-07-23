"use client";

import { useState } from "react";
import type { ProductoV2Flow, ProductoV2Item } from "../types";

function formatPrice(price: number | null): string {
  if (!price || price <= 0) return "";
  return `$ ${price.toLocaleString("es-CO")}`;
}

type View = { mode: "list" } | { mode: "editor"; productId: string | null };

export function ProductoV2Workspace({
  products,
  allFlows,
}: {
  products: ProductoV2Item[];
  allFlows: ProductoV2Flow[];
}) {
  const [view, setView] = useState<View>({ mode: "list" });

  const selected =
    view.mode === "editor" && view.productId
      ? products.find((product) => product.id === view.productId) ?? null
      : null;
  const isNew = view.mode === "editor" && view.productId === null;

  return (
    <div className="pv2-root">
      <style>{PV2_STYLES}</style>

      <div className="pv2-crumb">
        Aizenbot · <b>Producto V2</b>
        {view.mode === "editor" ? <> · {isNew ? "Nuevo" : "Editar"}</> : null}
      </div>

      {view.mode === "list" ? (
        /* ---------- LISTA ---------- */
        <>
          <div className="pv2-title-row">
            <h1 className="pv2-h1">Productos</h1>
            <span className="pv2-count">{products.length}</span>
            <button type="button" className="pv2-new-btn" onClick={() => setView({ mode: "editor", productId: null })}>
              + Nuevo producto
            </button>
          </div>
          <p className="pv2-intro">
            Cada producto es un contenedor: le anclás flujos y decís cuándo corre cada uno. El precio
            es opcional. Tocá un producto para verlo, o creá uno nuevo. <b>Vista previa:</b> la edición
            y el guardado llegan en el siguiente paso.
          </p>

          {products.length === 0 ? (
            <div className="pv2-empty">Todavía no hay productos. Tocá "Nuevo producto" para crear el primero.</div>
          ) : (
            <div className="pv2-list">
              {products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className="pv2-row"
                  onClick={() => setView({ mode: "editor", productId: product.id })}
                >
                  <span className={`pv2-avatar ${product.sells ? "sell" : "cat"}`}>
                    {product.sells ? "🛒" : "📄"}
                  </span>
                  <span className="pv2-row-main">
                    <span className="pv2-row-name">{product.name}</span>
                    <span className="pv2-row-meta">
                      <span className={`pv2-pill ${product.sells ? "sell" : "cat"}`}>
                        {product.sells ? "Vende" : "Solo catálogo"}
                      </span>
                      {product.price ? <span className="pv2-price">{formatPrice(product.price)}</span> : null}
                      {product.anchoredFlowTitle ? (
                        <span className="pv2-row-flow">📎 {product.anchoredFlowTitle}</span>
                      ) : (
                        <span className="pv2-row-flow off">sin flujo anclado</span>
                      )}
                    </span>
                  </span>
                  <span className="pv2-chevron">›</span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        /* ---------- EDITOR ---------- */
        <>
          <div className="pv2-title-row">
            <button type="button" className="pv2-back" onClick={() => setView({ mode: "list" })}>
              ← Productos
            </button>
          </div>
          <div className="pv2-title-row" style={{ marginTop: 6 }}>
            <h1 className="pv2-h1">{isNew ? "Nuevo producto" : selected?.name}</h1>
            <span className="pv2-badge">Vista previa · guardar próximamente</span>
          </div>

          <div className="pv2-card">
            {/* Identidad */}
            <div className="pv2-sec">
              <div className="pv2-sec-h">
                <span className="pv2-k">Identidad</span>
                <span className="pv2-req">Obligatorio</span>
              </div>
              <label className="pv2-f">Nombre del producto</label>
              <input
                className="pv2-inp big"
                value={selected?.name ?? ""}
                placeholder="Ej. Combo de camillas"
                readOnly
              />
              <div className="pv2-mt14">
                <label className="pv2-f">
                  Palabra distintiva <span className="pv2-faint">(la usa el candado para no confundirlo)</span>
                </label>
                {selected ? (
                  <span className="pv2-chip-dist"># {selected.distinctiveWord}</span>
                ) : (
                  <span className="pv2-disabled">Se saca sola del nombre al escribirlo.</span>
                )}
              </div>
            </div>

            {/* Tipo */}
            <div className="pv2-sec">
              <div className="pv2-sec-h">
                <span className="pv2-k">Tipo</span>
              </div>
              <div className="pv2-segs">
                <div className={`pv2-seg ${selected?.sells ? "on" : ""}`}>
                  <div className="pv2-st">🛒 Vende <span className="pv2-rd" /></div>
                  <div className="pv2-sd">Tiene precio y cierre. Es lo que se ancla desde el anuncio.</div>
                </div>
                <div className={`pv2-seg ${selected && !selected.sells ? "on" : ""}`}>
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
                {selected?.anchoredFlowTitle ? (
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
                  <div className="pv2-flow-empty">Todavía no hay un flujo anclado.</div>
                )}
                <div className="pv2-add-flow" aria-disabled="true">+ Anclar un flujo · y elegir cuándo se ejecuta</div>
              </div>
              <p className="pv2-hint">Hay {allFlows.length} flujos disponibles para anclar. Un mismo flujo se puede anclar a varios productos.</p>
            </div>

            {/* Precio */}
            <div className="pv2-sec">
              <div className="pv2-sec-h">
                <span className="pv2-k">Precio y cierre</span>
                <span className="pv2-req opt">Opcional · solo si vende</span>
              </div>
              {selected?.sells ? (
                <>
                  <label className="pv2-f">Precio</label>
                  <input className="pv2-inp" value={formatPrice(selected.price)} readOnly />
                </>
              ) : (
                <p className="pv2-disabled">
                  {selected ? 'Este producto es "solo catálogo" — no tiene precio.' : "Solo si el producto vende."}
                </p>
              )}
            </div>

            {/* Anuncios */}
            <div className="pv2-sec">
              <div className="pv2-sec-h">
                <span className="pv2-k">Anuncios que traen a este producto</span>
                <span className="pv2-req opt">Opcional</span>
              </div>
              <p className="pv2-disabled">
                Todavía no configurados. Acá vas a listar los anuncios de Meta que traen a este producto,
                para que el lead quede anclado desde el primer mensaje.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const PV2_STYLES = `
.pv2-root { --pv2-surface:#fff; --pv2-surface2:#f8f9fc; --pv2-ink:#1b1e29; --pv2-muted:#6b7280;
  --pv2-faint:#9aa1ad; --pv2-hair:#e7e9ef; --pv2-hair2:#dfe2ea; --pv2-accent:#5b52e0; --pv2-accent-ink:#4a41c8;
  --pv2-accent-soft:#edecfc; --pv2-green:#12805c; --pv2-green-soft:#dcf1e8; --pv2-amber:#9a6410; --pv2-amber-soft:#f6ebd7;
  --pv2-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  max-width:880px; margin:0 auto; padding:8px 2px 60px; color:var(--pv2-ink);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; line-height:1.5; }
@media (prefers-color-scheme:dark){ .pv2-root { --pv2-surface:#181b22; --pv2-surface2:#1e222b; --pv2-ink:#e9ebf0;
  --pv2-muted:#9aa2b1; --pv2-faint:#6d7583; --pv2-hair:#282d37; --pv2-hair2:#333a46; --pv2-accent:#8078f0;
  --pv2-accent-ink:#a49ef6; --pv2-accent-soft:#20203a; --pv2-green:#4cbd8e; --pv2-green-soft:#132a22;
  --pv2-amber:#d29a4e; --pv2-amber-soft:#2f2611; } }
.pv2-root *{ box-sizing:border-box; }
.pv2-crumb{ font-family:var(--pv2-mono); font-size:12px; color:var(--pv2-faint); }
.pv2-crumb b{ color:var(--pv2-accent); }
.pv2-title-row{ display:flex; align-items:center; gap:12px; margin-top:8px; flex-wrap:wrap; }
.pv2-h1{ font-size:clamp(21px,4vw,27px); letter-spacing:-.02em; margin:0; font-weight:750; }
.pv2-count{ font-family:var(--pv2-mono); font-size:12px; color:var(--pv2-muted); background:var(--pv2-surface2);
  border:1px solid var(--pv2-hair); border-radius:20px; padding:2px 10px; font-weight:600; }
.pv2-new-btn{ margin-left:auto; height:38px; padding:0 16px; border-radius:11px; border:none; cursor:pointer;
  background:var(--pv2-accent); color:#fff; font-weight:650; font-size:13.5px; font-family:inherit; }
.pv2-back{ background:none; border:none; color:var(--pv2-accent); font-weight:600; font-size:14px; cursor:pointer;
  padding:0; font-family:inherit; }
.pv2-badge{ font-family:var(--pv2-mono); font-size:10.5px; letter-spacing:.06em; text-transform:uppercase;
  color:var(--pv2-accent-ink); background:var(--pv2-accent-soft); padding:3px 9px; border-radius:20px; font-weight:600; }
.pv2-intro{ color:var(--pv2-muted); font-size:14px; margin:10px 0 0; max-width:64ch; }
.pv2-empty{ margin-top:22px; padding:28px; text-align:center; color:var(--pv2-muted); background:var(--pv2-surface2);
  border:1px solid var(--pv2-hair); border-radius:14px; }
/* lista */
.pv2-list{ margin-top:20px; display:flex; flex-direction:column; gap:10px; }
.pv2-row{ display:flex; align-items:center; gap:14px; width:100%; text-align:left; cursor:pointer;
  background:var(--pv2-surface); border:1px solid var(--pv2-hair); border-radius:14px; padding:14px 16px; font-family:inherit;
  transition:border-color .12s, box-shadow .12s; }
.pv2-row:hover{ border-color:var(--pv2-accent); box-shadow:0 8px 22px -16px rgba(20,24,40,.35); }
.pv2-avatar{ width:44px; height:44px; border-radius:12px; display:flex; align-items:center; justify-content:center;
  font-size:20px; flex-shrink:0; }
.pv2-avatar.sell{ background:var(--pv2-green-soft); }
.pv2-avatar.cat{ background:var(--pv2-amber-soft); }
.pv2-row-main{ min-width:0; flex:1; display:flex; flex-direction:column; gap:5px; }
.pv2-row-name{ font-weight:650; font-size:15.5px; color:var(--pv2-ink); }
.pv2-row-meta{ display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
.pv2-pill{ font-size:11.5px; font-weight:600; padding:2px 9px; border-radius:20px; }
.pv2-pill.sell{ color:var(--pv2-green); background:var(--pv2-green-soft); }
.pv2-pill.cat{ color:var(--pv2-amber); background:var(--pv2-amber-soft); }
.pv2-price{ font-family:var(--pv2-mono); font-size:12.5px; color:var(--pv2-ink); font-weight:600; }
.pv2-row-flow{ font-size:12.5px; color:var(--pv2-muted); }
.pv2-row-flow.off{ color:var(--pv2-faint); font-style:italic; }
.pv2-chevron{ color:var(--pv2-faint); font-size:22px; line-height:1; flex-shrink:0; }
/* editor */
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
