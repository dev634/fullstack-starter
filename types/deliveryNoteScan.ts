export type ScannedItem = {
  // Composed server-side from brand + reference — see composeMaterialName
  // in lib/deliveryNoteScan.ts. `unit` is gone: a scan no longer asks the
  // model for one (see schemas/deliveryNoteScan.ts), it stays only as a
  // hand-editable ProjectMaterial field (forms/EditMaterialForm.tsx).
  name: string;
  brand: string | null;
  reference: string | null;
  quantity: number;
};

export type DeliveryNoteScanActionState = {
  type: "error" | "success" | null;
  message: string;
  items?: ScannedItem[];
  // Note-level supplier read from the bulletin header (one per delivery note).
  supplier?: string | null;
};

export type ApplyDeliveryScanActionState = {
  type: "error" | "success" | "zodError" | null;
  message: string;
};
