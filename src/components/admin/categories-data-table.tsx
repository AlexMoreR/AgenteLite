"use client";

import { useState } from "react";
import { Edit3, MoreHorizontal, Package, Tag, Trash2 } from "lucide-react";
import { adminDeleteCategoryAction } from "@/app/actions/catalog-actions";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  productsCount: number;
};

type CategoriesDataTableProps = {
  categories: CategoryRow[];
  onEditCategory: (categoryId: string) => void;
};

function CategoryLogo({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [hasError, setHasError] = useState(false);

  if (!logoUrl || hasError) {
    return (
      <div className="grid h-9 w-9 place-items-center rounded-md border bg-muted text-xs font-semibold text-muted-foreground">
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={logoUrl}
      alt={`Logo ${name}`}
      className="h-9 w-9 rounded-md border object-cover"
      onError={() => setHasError(true)}
    />
  );
}

export function CategoriesDataTable({ categories, onEditCategory }: CategoriesDataTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/70 hover:bg-muted/70">
            <TableHead className="normal-case tracking-normal">
              <span className="inline-flex items-center gap-2 text-[15px] font-normal text-muted-foreground">
                <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                Categoria
              </span>
            </TableHead>
            <TableHead className="normal-case tracking-normal">
              <span className="inline-flex items-center gap-2 text-[15px] font-normal text-muted-foreground">
                <Package className="h-3.5 w-3.5 text-muted-foreground" />
                Productos
              </span>
            </TableHead>
            <TableHead className="w-[140px] normal-case tracking-normal text-left">
              <span className="inline-flex items-center justify-start gap-2 text-[15px] font-normal text-muted-foreground">
                <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                Acciones
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="py-10 text-center text-sm text-muted-foreground">
                Aun no hay categorias.
              </TableCell>
            </TableRow>
          ) : (
            categories.map((category) => (
              <TableRow key={category.id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <CategoryLogo name={category.name} logoUrl={category.logoUrl} />
                    <p className="text-sm font-medium text-foreground">{category.name}</p>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{category.productsCount}</TableCell>
                <TableCell className="text-left">
                  <form data-delete-category-id={category.id} action={adminDeleteCategoryAction}>
                    <input type="hidden" name="returnTo" value="/admin/categorias" />
                    <input type="hidden" name="categoryId" value={category.id} />
                  </form>
                  <div className="flex items-center justify-start gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 border border-transparent hover:border-border"
                      onClick={() => onEditCategory(category.id)}
                      aria-label={`Editar ${category.name}`}
                    >
                      <Edit3 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 border border-transparent text-destructive hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        const forms = document.querySelectorAll<HTMLFormElement>(
                          `form[data-delete-category-id="${category.id}"]`,
                        );
                        const form =
                          Array.from(forms).find((candidate) => candidate.offsetParent !== null) ??
                          forms[0] ??
                          null;
                        form?.requestSubmit();
                      }}
                      aria-label={`Eliminar ${category.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
