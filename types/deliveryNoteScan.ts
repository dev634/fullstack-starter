export type ScannedItem = {
  name: string;
  quantity: number;
  unit: string | null;
  reference: string | null;
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
