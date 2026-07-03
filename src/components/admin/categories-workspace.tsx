"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Plus, Tag, X } from "lucide-react";
import { adminCreateCategoryAction, adminUpdateCategoryAction } from "@/app/actions/catalog-actions";
import { CategoriesDataTable } from "@/components/admin/categories-data-table";
import { Input } from "@/components/ui/input";

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  productsCount: number;
};

type CategoriesWorkspaceProps = {
  categories: CategoryRow[];
};

export function CategoriesWorkspace({ categories }: CategoriesWorkspaceProps) {
  const [modal, setModal] = useState<"new" | "edit" | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const activeCategory = useMemo(
    () => categories.find((category) => category.id === activeCategoryId) ?? null,
    [categories, activeCategoryId],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const openNewModal = () => {
    setActiveCategoryId(null);
    setPreviewUrl(null);
    setModal("new");
  };

  const openEditModal = (categoryId: string) => {
    setActiveCategoryId(categoryId);
    setPreviewUrl(null);
    setModal("edit");
  };

  const closeModal = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setModal(null);
    setActiveCategoryId(null);
  };

  const handleLogoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    if (!file) {
      setPreviewUrl(null);
      return;
    }

    setPreviewUrl(URL.createObjectURL(file));
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-1 text-lg font-semibold tracking-tight text-foreground md:text-xl">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <span>Categorias</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">Gestiona categorias del catalogo.</p>
        </div>
        <button
          type="button"
          onClick={openNewModal}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Nueva categoria
        </button>
      </div>

      <CategoriesDataTable categories={categories} onEditCategory={openEditModal} />

      {modal === "new" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Nueva categoria"
          onClick={closeModal}
        >
          <div
            className="saas-card w-full max-w-lg rounded-xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Nueva categoria</h2>
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border text-muted-foreground transition hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form action={adminCreateCategoryAction} encType="multipart/form-data" className="space-y-3">
              <input type="hidden" name="returnTo" value="/admin/categorias" />
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-foreground">Nombre</span>
                <Input name="name" placeholder="Ej. Camillas" required />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-foreground">Logo (opcional)</span>
                <Input name="logo" type="file" accept="image/*" onChange={handleLogoChange} />
              </label>
              {previewUrl ? (
                <div className="overflow-hidden rounded-lg border bg-muted">
                  <div className="relative aspect-[4/3] w-full">
                    <Image src={previewUrl} alt="Vista previa del logo" fill className="object-contain p-3" unoptimized />
                  </div>
                </div>
              ) : null}
              <button
                type="submit"
                className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                Guardar categoria
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {modal === "edit" && activeCategory ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Editar ${activeCategory.name}`}
          onClick={closeModal}
        >
          <div
            className="saas-card w-full max-w-lg rounded-xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Editar categoria</h2>
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border text-muted-foreground transition hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form action={adminUpdateCategoryAction} encType="multipart/form-data" className="space-y-3">
              <input type="hidden" name="returnTo" value="/admin/categorias" />
              <input type="hidden" name="categoryId" value={activeCategory.id} />
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-foreground">Nombre</span>
                <Input name="name" defaultValue={activeCategory.name} required />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-foreground">Logo (opcional)</span>
                <Input name="logo" type="file" accept="image/*" onChange={handleLogoChange} />
              </label>
              {previewUrl ? (
                <div className="overflow-hidden rounded-lg border bg-muted">
                  <div className="relative aspect-[4/3] w-full">
                    <Image src={previewUrl} alt="Vista previa del logo" fill className="object-contain p-3" unoptimized />
                  </div>
                </div>
              ) : activeCategory.logoUrl ? (
                <div className="overflow-hidden rounded-lg border bg-muted">
                  <div className="relative aspect-[4/3] w-full">
                    <Image src={activeCategory.logoUrl} alt={`Logo actual de ${activeCategory.name}`} fill className="object-contain p-3" unoptimized />
                  </div>
                </div>
              ) : null}
              <button
                type="submit"
                className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                Guardar cambios
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
