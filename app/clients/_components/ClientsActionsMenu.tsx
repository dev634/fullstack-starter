"use client";

import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  TrashIcon,
  ClockIcon,
  PlusIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import ActionsMenu, { type ActionMenuItem } from "@/components/ActionsMenu";

export default function ClientsActionsMenu({ canEdit, exportHref }: { canEdit: boolean; exportHref: string }) {
  const { t } = useTranslation();

  const items: ActionMenuItem[] = [
    { key: "export", href: exportHref, label: t.clients.list.exportCsv, icon: ArrowDownTrayIcon, external: true },
    { key: "export-contacts", href: "/clients/contacts/export", label: t.contacts.exportCsv, icon: UserGroupIcon, external: true },
    ...(canEdit
      ? [
          { key: "import", href: "/clients/import", label: t.clients.list.import, icon: ArrowUpTrayIcon },
          { key: "import-contacts", href: "/clients/contacts/import", label: t.contacts.importCsv, icon: UserGroupIcon },
          { key: "trash", href: "/clients/trash", label: t.clients.list.trash, icon: TrashIcon },
          { key: "activity", href: "/clients/activity", label: t.clients.list.activity, icon: ClockIcon },
          {
            key: "add",
            href: "/clients/add",
            label: t.clients.list.addClient,
            icon: PlusIcon,
            className: "font-medium text-primary",
          },
        ]
      : []),
  ];

  return <ActionsMenu label={t.clients.list.actions} items={items} />;
}
