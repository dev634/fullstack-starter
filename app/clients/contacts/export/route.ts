import { findAllWithClientEmail } from "@/repository/contacts";
import { CONTACT_CSV_COLUMNS, csvCell } from "@/lib/csv";

/**
 * Export every contact (of non-trashed organisations) as a CSV download, with
 * the owning organisation's email as the link column so the file round-trips
 * through /clients/contacts/import. Protected by the /clients middleware.
 */
export async function GET() {
  const contacts = await findAllWithClientEmail();

  const header = CONTACT_CSV_COLUMNS.map((c) => csvCell(c.header)).join(",");
  const rows = contacts.map((contact) => {
    const row: Record<string, unknown> = {
      companyEmail: contact.client.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      role: contact.role,
      email: contact.email,
      phone: contact.phone,
      isPrimary: contact.isPrimary ? "true" : "false",
    };
    return CONTACT_CSV_COLUMNS.map((c) => csvCell(row[c.key])).join(",");
  });
  // Prepend a BOM so Excel opens UTF-8 accents correctly.
  const csv = "﻿" + [header, ...rows].join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts.csv"`,
    },
  });
}
