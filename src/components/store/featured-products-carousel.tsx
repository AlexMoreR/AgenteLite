"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";

type FeaturedProductItem = {
  id: string;
  href: string;
  name: string;
  thumbnailUrl: string;
  priceLabel: string;
};

type FeaturedProductsCarouselProps = {
  products: FeaturedProductItem[];
};

export function FeaturedProductsCarousel({ products }: FeaturedProductsCarouselProps) {
  // Intent: propietario de salón evaluando productos premium; debe identificar rápido la pieza destacada; debe sentirse refinado y preciso.
  // Palette: violeta principal del hero, ciruela profunda y reflejos lavanda para mantener continuidad con el escaparate premium.
  // Depth: capas por gradiente y bordes suaves, evitando cajas internas para que el bloque se sienta más editorial.
  // Surfaces: base ciruela, reflejos lavanda y velo oscuro inferior para anclar texto e imagen sin cambiar el tamaño del módulo.
  // Typography: titulares compactos y precio con números tabulares para mejorar lectura y presencia.
  // Spacing: base de 4px con respiración contenida para conservar la huella actual.
  const [activeIndex, setActiveIndex] = React.useState(0);
  const touchStartX = React.useRef<number | null>(null);
  const touchDeltaX = React.useRef(0);
  const isSwiping = React.useRef(false);

  React.useEffect(() => {
    if (products.length < 2) {
      return;
    }

    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % products.length);
    }, 5000);

    return () => window.clearInterval(timer);
  }, [products.length]);

  if (products.length === 0) {
    return null;
  }

  const goTo = (index: number) => {
    setActiveIndex(index);
  };

  const goPrev = () => {
    setActiveIndex((current) => (current - 1 + products.length) % products.length);
  };

  const goNext = () => {
    setActiveIndex((current) => (current + 1) % products.length);
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
    touchDeltaX.current = 0;
    isSwiping.current = false;
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartX.current === null) {
      return;
    }

    touchDeltaX.current = (event.touches[0]?.clientX ?? 0) - touchStartX.current;

    if (Math.abs(touchDeltaX.current) > 10) {
      isSwiping.current = true;
    }
  };

  const handleTouchEnd = () => {
    if (touchStartX.current === null) {
      return;
    }

    if (touchDeltaX.current <= -40) {
      goNext();
    } else if (touchDeltaX.current >= 40) {
      goPrev();
    }

    touchStartX.current = null;
    touchDeltaX.current = 0;
    window.setTimeout(() => {
      isSwiping.current = false;
    }, 0);
  };

  const handleSlideClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isSwiping.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="relative min-w-0 -mx-4 w-[calc(100%+2rem)] md:mx-0 md:w-full">
      <div className="overflow-hidden rounded-none md:rounded-[30px]">
        <div
          className="flex w-full touch-pan-y transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${activeIndex * 100}%)` }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          {products.map((product) => (
            <Link
              key={product.id}
              href={product.href}
              className="group relative block w-full shrink-0 basis-full overflow-hidden rounded-none border border-white/12 bg-[linear-gradient(135deg,rgba(122,30,199,0.34)_0%,rgba(92,18,167,0.3)_36%,rgba(63,10,118,0.38)_100%)] shadow-[0_30px_70px_-42px_rgba(15,23,42,0.82)] transition duration-300 hover:border-white/18 md:rounded-[30px]"
              onClick={handleSlideClick}
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(255,255,255,0.26),transparent_26%),radial-gradient(circle_at_82%_28%,rgba(253,216,255,0.18),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(30,6,56,0.22)_58%,rgba(9,2,26,0.38)_100%)]" />
              <div className="absolute inset-y-0 left-0 w-[58%] bg-[linear-gradient(90deg,rgba(18,4,36,0.18),transparent)]" />
              <div className="absolute inset-x-0 bottom-0 h-10 bg-[linear-gradient(180deg,transparent,rgba(14,4,30,0.28))] md:h-14" />
              <div className="relative grid min-h-[9rem] grid-cols-[1fr_1fr] gap-2 px-3 py-2 md:min-h-[12.5rem] md:grid-cols-[0.94fr_1.06fr] md:items-center md:gap-0 md:p-5">
                <div className="flex h-full flex-col justify-between pl-2 pr-2 md:pl-0 md:pr-5">
                  <div className="space-y-1.5 md:space-y-2">
                    <p className="text-[9px] uppercase tracking-[0.24em] text-white/62 md:text-[11px] md:tracking-[0.28em]">Destacada</p>
                    <p className="line-clamp-2 max-w-[8.9rem] text-[0.96rem] font-semibold leading-[0.95] tracking-[-0.03em] text-white md:max-w-[15rem] md:text-[2rem] md:leading-[0.92]">
                      {product.name}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[0.82rem] font-semibold tabular-nums text-white/92 md:text-base">{product.priceLabel}</p>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-white/54 md:text-[11px]">Garantia 1 Año</p>
                  </div>
                </div>
                <div className="relative flex items-center justify-end">
                  <div className="absolute right-[14%] top-[12%] h-16 w-16 rounded-full bg-white/12 blur-2xl md:h-28 md:w-28" />
                  <div className="absolute right-[18%] top-1/2 h-24 w-24 -translate-y-1/2 rounded-full bg-fuchsia-200/10 blur-3xl md:h-40 md:w-40" />
                  <div className="absolute bottom-3 right-[18%] h-8 w-24 rounded-full bg-black/30 blur-xl md:h-10 md:w-40" />
                  <div className="absolute right-[6%] top-[18%] h-[68%] w-[62%] rounded-[28px] bg-[linear-gradient(135deg,rgba(255,255,255,0.12),rgba(255,255,255,0.02)_52%,rgba(255,255,255,0.08))] opacity-70 blur-[1px]" />
                  <img
                    src={product.thumbnailUrl}
                    alt={product.name}
                    className="relative z-10 h-28 w-full object-contain drop-shadow-[0_20px_28px_rgba(8,3,23,0.42)] transition duration-500 group-hover:scale-[1.05] group-hover:-rotate-1 md:h-44 md:max-w-[16rem] md:drop-shadow-[0_24px_34px_rgba(8,3,23,0.44)]"
                  />
                </div>
              </div>
              <div className="pointer-events-none absolute inset-x-5 bottom-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.45),transparent)] opacity-70" />
            </Link>
          ))}
        </div>
      </div>

      {products.length > 1 ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-between px-1 md:px-2">
            <button
              type="button"
              onClick={goPrev}
              className="pointer-events-auto inline-flex h-7 w-7 -translate-x-2 items-center justify-center rounded-full border border-white/10 bg-[rgba(24,8,44,0.42)] text-white/84 backdrop-blur-md transition duration-200 hover:border-white/16 hover:bg-[rgba(16,5,31,0.58)] md:h-9 md:w-9 md:-translate-x-4"
              aria-label="Producto destacado anterior"
            >
              <ChevronLeft className="h-3.5 w-3.5 md:h-4 md:w-4" />
            </button>
            <button
              type="button"
              onClick={goNext}
              className="pointer-events-auto inline-flex h-7 w-7 translate-x-2 items-center justify-center rounded-full border border-white/10 bg-[rgba(24,8,44,0.42)] text-white/84 backdrop-blur-md transition duration-200 hover:border-white/16 hover:bg-[rgba(16,5,31,0.58)] md:h-9 md:w-9 md:translate-x-4"
              aria-label="Siguiente producto destacado"
            >
              <ChevronRight className="h-3.5 w-3.5 md:h-4 md:w-4" />
            </button>
          </div>

          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 md:bottom-3 md:gap-2">
            {products.map((product, index) => (
              <button
                key={product.id}
                type="button"
                onClick={() => goTo(index)}
                className={`h-2 rounded-full transition-all ${
                  index === activeIndex
                    ? "w-5 bg-white shadow-[0_0_16px_rgba(255,255,255,0.32)] md:w-6"
                    : "w-1.5 bg-white/32 hover:bg-white/54 md:w-2"
                }`}
                aria-label={`Ir al destacado ${index + 1}`}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
