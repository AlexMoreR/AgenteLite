import {
  Calendar,
  CircleCheck,
  CircleDollarSign,
  FileText,
  Flag,
  Folder,
  Heart,
  Layers,
  Lightbulb,
  Megaphone,
  Rocket,
  Shapes,
  Star,
  Target,
  TriangleAlert,
  User,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { IconoDeTipo as ClaveDeIcono } from "../services/reglas";

/** El dibujo de cada ícono de tipo (las claves están en reglas.ts: ICONOS_DE_TIPO). */
export const DIBUJO_DEL_ICONO: Record<ClaveDeIcono, LucideIcon> = {
  capas: Layers,
  bombillo: Lightbulb,
  chulo: CircleCheck,
  bandera: Flag,
  objetivo: Target,
  estrella: Star,
  cohete: Rocket,
  persona: User,
  dinero: CircleDollarSign,
  herramienta: Wrench,
  megafono: Megaphone,
  carpeta: Folder,
  documento: FileText,
  calendario: Calendar,
  alerta: TriangleAlert,
  corazon: Heart,
};

export function IconoDeTipo({
  icono,
  color,
  className,
}: {
  icono: string | null | undefined;
  color?: string;
  className?: string;
}) {
  const Dibujo = (icono && DIBUJO_DEL_ICONO[icono as ClaveDeIcono]) || Shapes;
  return <Dibujo className={className} style={color ? { color } : undefined} aria-hidden />;
}
