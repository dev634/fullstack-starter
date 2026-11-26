import type { Client } from "@/app/generated/prisma/client";

/**
 * The columns of a company that UpdateClientForm reads, and only those: the
 * hidden `id`, the photo, and the nine fields ClientFields renders. A POSITIVE
 * list — a column added to `Client` does not reach the form until it is named
 * here. Narrowing the prop's type is not what keeps a column out of the HTML
 * (structural typing lets a wider object through): the literal built by
 * toUpdateClientFormValues is.
 */
export type UpdateClientFormValues = Pick<
  Client,
  "id" | "companyName" | "email" | "phone" | "website" | "address" | "zipCode" | "city" | "country" | "status" | "photoUrl"
>;

/**
 * The form's values, projected from the company row field by field (pure).
 * Not in UpdateClientForm.tsx: the exports of a `'use client'` module are client
 * references, which the Server Component that builds the props cannot call.
 */
export function toUpdateClientFormValues(row: Client): UpdateClientFormValues {
  return {
    id: row.id,
    companyName: row.companyName,
    email: row.email,
    phone: row.phone,
    website: row.website,
    address: row.address,
    zipCode: row.zipCode,
    city: row.city,
    country: row.country,
    status: row.status,
    photoUrl: row.photoUrl,
  };
}
