'use client'
import { createContext, useContext } from "react";

// Signal broadcast by TasksSection to tell a specific
// ProjectTaskCategorySection to open itself, e.g. right after a task or a
// series was created inside that category. A fresh object is set on every
// creation, so two creations in a row in the same category still produce two
// distinct signals (object identity changes even when categoryId doesn't).
export type CategoryRevealSignal = { categoryId: number } | null;

const CategoryRevealContext = createContext<CategoryRevealSignal>(null);

export const CategoryRevealProvider = CategoryRevealContext.Provider;

export function useCategoryReveal(): CategoryRevealSignal {
  return useContext(CategoryRevealContext);
}
