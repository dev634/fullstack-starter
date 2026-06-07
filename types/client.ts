import { Client } from "@/app/generated/prisma/client";

export type ClientActionState = {
  type: "error" | "success" | "zodError" | null;
  message: string;
  fieldsForm?: Partial<Omit<Client, "id">>;
  data?: unknown;
};
