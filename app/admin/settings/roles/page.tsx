import { requireAdminTab } from "@/lib/adminAccess";
import { getAccessConfig } from "@/lib/access";
import AccessMatrixForm from "./_components/AccessMatrixForm";

// Rôles & accès tab: the RBAC matrix (capability -> minimum role). Gated by
// settings.manage (locked to SUPERADMIN).
export default async function AdminRolesPage() {
  await requireAdminTab("settings");
  const config = await getAccessConfig();

  return <AccessMatrixForm config={config} />;
}
