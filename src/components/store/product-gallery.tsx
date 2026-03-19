"use client";

import { useMemo, useState } from "react";

type ProductGalleryProps = {
  name: string;
  images: string[];
};

export function ProductGallery({ name, images }: ProductGalleryProps) {
  const gallery = useMemo(
    () => Array.from(new Set(images.map((value) => value.trim()).filter(Boolean))),
    [images],
  );
  const [activeIndex, setActiveIndex] = useState(0);

  if (gallery.length === 0) {
    return (
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <div className="grid h-[280px] place-items-center text-sm text-slate-500 md:h-[460px]">
          Sin imagen disponible
        </div>
      </div>
    );
  }

  const mainImage = gallery[Math.min(activeIndex, gallery.length - 1)];

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
      <div className="relative">
        <img
          src={mainImage}
          alt={name}
          className="h-[280px] w-full object-cover md:h-[460px]"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/35 to-transparent" />
      </div>

      {gallery.length > 1 ? (
        <div className="space-y-2 border-t border-[var(--line)] p-3">
          <p className="text-xs font-medium text-slate-500">
            Galeria ({gallery.length} imagenes)
          </p>
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-6 md:grid-cols-7">
          {gallery.map((url, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={`${url}-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`relative aspect-square overflow-hidden rounded-md border transition ${
                  active
                    ? "border-violet-700 ring-2 ring-violet-300/60"
                    : "border-[var(--line)] hover:border-violet-300"
                }`}
                aria-label={`Ver imagen ${index + 1}`}
              >
                <img src={url} alt={`${name} imagen ${index + 1}`} className="h-full w-full object-cover" />
              </button>
            );
          })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
