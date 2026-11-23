import { search, type ClientSortField } from "@/repository/clients";
import { getAccessContext, projectIdFilter } from "@/lib/accessContext";
import { canAccessArea } from "@/lib/areaAccess";
import { CLIENT_CSV_COLUMNS, csvResponse } from "@/lib/csv";
import { getLocale } from "@/lib/i18n/getLocale";
import { requireAppUser } from "@/lib/requireAppUser";

const SORT_FIELDS: ClientSortField[] = ["companyName", "email", "city"];

/**
 * Export the (filtered/sorted) clients as a CSV download. Honours the same
 * ?q/?sort/?dir query used by the list.
 *
 * The /clients proxy rule gates this too; the in-handler check is the second
 * layer, because this response streams every organisation's contact details.
 * requireAppUser only checks role/session — a caller whose job function
 * hides the `clients` rubrique must be refused here too, or the CSV becomes a
 * way around that restriction by direct URL.
 */
export async function GET(request: Request) {
  const gate = await requireAppUser();
  if (!gate.ok) return gate.response;
  if (!(await canAccessArea("clients"))) return new Response("Forbidden", { status: 403 });

  const params = new URL(request.url).searchParams;
  const q = params.get("q") ?? "";
  const sortRaw = params.get("sort");
  const sortField: ClientSortField = SORT_FIELDS.includes(sortRaw as ClientSortField)
    ? (sortRaw as ClientSortField)
    : "companyName";
  const dir = params.get("dir") === "desc" ? "desc" : "asc";

  const { clients } = await search({ q, sortField, dir, page: 1, pageSize: 100000, projectIds: projectIdFilter(await getAccessContext()) });

  return csvResponse(CLIENT_CSV_COLUMNS, clients, "clients.csv", await getLocale());
}
