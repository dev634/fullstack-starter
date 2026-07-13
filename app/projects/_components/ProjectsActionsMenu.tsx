"use client";

import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  TrashIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import ActionsMenu, { type ActionMenuItem } from "@/components/ActionsMenu";

export default function ProjectsActionsMenu({ canEdit, exportHref }: { canEdit: boolean; exportHref: string }) {
  const { t } = useTranslation();

  const items: ActionMenuItem[] = [
    { key: "export", href: exportHref, label: t.projects.list.exportCsv, icon: ArrowDownTrayIcon, external: true },
    ...(canEdit
      ? [
          { key: "import", href: "/projects/import", label: t.projects.list.import, icon: ArrowUpTrayIcon },
          { key: "trash", href: "/projects/trash", label: t.projects.list.trash, icon: TrashIcon },
          { key: "activity", href: "/projects/activity", label: t.projects.list.activity, icon: ClockIcon },
        ]
      : []),
  ];

  return <ActionsMenu label={t.projects.list.actions} items={items} />;
}
