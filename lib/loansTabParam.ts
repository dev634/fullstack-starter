/**
 * The "Prêts" page's own `?tab=` query param — same shape/spirit as
 * lib/folderIdParam.ts's `parseFolderIdParam`: a pure parser so the page
 * component can stay a thin server-rendered consumer, and an invalid or
 * absent value resolves to the default tab rather than failing the page (a
 * garbled `?tab=` only ever changes which slice of the same data is shown).
 */
export const LOANS_TABS = ["mine", "borrowed", "ongoing", "returned"] as const;

export type LoansTab = (typeof LOANS_TABS)[number];

export function isLoansTab(value: string): value is LoansTab {
  return (LOANS_TABS as readonly string[]).includes(value);
}

export function parseLoansTabParam(value: string | string[] | undefined): LoansTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw !== undefined && isLoansTab(raw) ? raw : "mine";
}
