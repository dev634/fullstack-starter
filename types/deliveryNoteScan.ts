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
  // "warning": the materials ARE applied but the delivery note's archive was not saved (it was beyond
  // what the storage takes): the interface must show `message` and not close as it does on "success".
  type: "error" | "success" | "warning" | "zodError" | null;
  message: string;
  // Was missing entirely (adversarial pass 2, point 4): every other action's
  // zodError carries a fieldsForm, but this one returned only a generic
  // "validation error" message — on a batch of reviewed lines, one bad field
  // said nothing about which. See actions/deliveryNoteScan/deliveryNoteScan.ts.
  fieldsForm?: Record<string, string>;
};
