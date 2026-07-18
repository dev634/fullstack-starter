export type ScannedItem = {
  name: string;
  quantity: number;
  unit: string | null;
};

export type DeliveryNoteScanActionState = {
  type: "error" | "success" | null;
  message: string;
  items?: ScannedItem[];
};

export type ApplyDeliveryScanActionState = {
  type: "error" | "success" | "zodError" | null;
  message: string;
};
