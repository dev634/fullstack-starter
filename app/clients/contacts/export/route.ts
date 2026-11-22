import { findAllWithClientEmail } from "@/repository/contacts";
import { getAccessContext, projectIdFilter } from "@/lib/accessContext";
import { canAccessArea } from "@/lib/areaAccess";
import { CONTACT_CSV_COLUMNS, buildCsv, csvDelimiterForLocale } from "@/lib/csv";
import { getLocale } from "@/lib/i18n/getLocale";
import { requireAppUser } from "@/lib/requireAppUser";

/**
 * Export every contact (of non-trashed, reachable organisations) as a CSV
 * download, with the owning organisation's email as the link column so the
 * file round-trips through /clients/contacts/import.
 *
 * The /clients proxy rule gates this too; the in-handler check is the second
 * layer, because this response streams every contact's personal details.
 * requireAppUser only checks role/session — a caller whose job function
 * hides `clients.contacts` must be refused here too, or the CSV becomes a way
 * around that restriction by direct URL. The query itself is also scoped to
 * the caller's accessible projects (projectIdFilter), the same rule the
 * clients/projects exports already apply — this route previously streamed
 * every organisation's contacts regardless of project scope.
 */
export async function GET() {
  const gate = await requireAppUser();
  if (!gate.ok) return gate.response;
  if (!(await canAccessArea("clients.contacts"))) return new Response("Forbidden", { status: 403 });

  const contacts = await findAllWithClientEmail(projectIdFilter(await getAccessContext()));

  const rows = contacts.map((contact) => {
    const row: Record<string, unknown> = {
      companyEmail: contact.client.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      role: contact.jobFunction?.name ?? "",
      email: contact.email,
      phone: contact.phone,
      isPrimary: contact.isPrimary ? "true" : "false",
    };
    return CONTACT_CSV_COLUMNS.map((c) => row[c.key]);
  });
  // ";" for a French user (Excel FR), "," otherwise; BOM so Excel reads the accents.
  const csv = buildCsv(
    CONTACT_CSV_COLUMNS.map((c) => c.header),
    rows,
    csvDelimiterForLocale(await getLocale())
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts.csv"`,
    },
  });
}
