"use client";

import { useState } from "react";
import { Download } from "lucide-react";

type DownloadQuotePdfButtonProps = {
  className?: string;
};

export function DownloadQuotePdfButton({ className }: DownloadQuotePdfButtonProps) {
  const [isPrinting, setIsPrinting] = useState(false);

  const handleClick = () => {
    setIsPrinting(true);

    window.setTimeout(() => {
      window.print();
      setIsPrinting(false);
    }, 50);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPrinting}
      className={className}
    >
      <Download className="h-4 w-4" />
      {isPrinting ? "Preparando PDF..." : "Descargar PDF"}
    </button>
  );
}
