import { cn } from "@/lib/utils";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("saas-card rounded-xl p-5", className)}
      {...props}
    />
  );
}
