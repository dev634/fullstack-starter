import { search, type ClientSortField } from "@/repository/clients";

const COLUMNS: { key: string; header: string }[] = [
  { key: "firstName", header: "Firstname" },
  { key: "lastName", header: "Lastname" },
  { key: "email", header: "Email" },
  { key: "companyName", header: "Company" },
  { key: "phone", header: "Phone" },
  { key: "website", header: "Website" },
  { key: "status", header: "Status" },
  { key: "address", header: "Address" },
  { key: "city", header: "City" },
  { key: "zipCode", header: "Zip Code" },
  { key: "country", header: "Country" },
];

const SORT_FIELDS: ClientSortField[] = ["firstName", "lastName", "companyName", "email"];

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

/**
 * Export the (filtered/sorted) clients as a CSV download. Honours the same
 * ?q/?sort/?dir query used by the list. Protected by the /clients middleware.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = params.get("q") ?? "";
  const sortRaw = params.get("sort");
  const sortField: ClientSortField = SORT_FIELDS.includes(sortRaw as ClientSortField)
    ? (sortRaw as ClientSortField)
    : "firstName";
  const dir = params.get("dir") === "desc" ? "desc" : "asc";

  const { clients } = await search({ q, sortField, dir, page: 1, pageSize: 100000 });

  const header = COLUMNS.map((c) => csvCell(c.header)).join(",");
  const rows = clients.map((client) =>
    COLUMNS.map((c) => csvCell((client as Record<string, unknown>)[c.key])).join(",")
  );
  // Prepend a BOM so Excel opens UTF-8 accents correctly.
  const csv = "﻿" + [header, ...rows].join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clients.csv"`,
    },
  });
}
