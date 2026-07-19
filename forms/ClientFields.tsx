import { Client } from "@/app/generated/prisma/client";
import { Input } from "@/components/Inputs";
import { useTranslation } from "@/components/LocaleProvider";

type ClientFieldsProps = {
  values: Omit<Client, "id" | "photoUrl" | "deletedAt">;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  errors?: Record<string, string>;
};

export function ClientFields({ values, onChange, errors }: ClientFieldsProps) {
  const { t } = useTranslation();

  const CLIENT_FIELDS: {
    label: string;
    name: keyof Omit<Client, "id" | "photoUrl" | "status" | "deletedAt">;
    type?: "text" | "email";
    fullWidth?: boolean;
  }[] = [
    { label: t.clients.fields.company, name: "companyName", fullWidth: true },
    { label: t.clients.fields.email, name: "email", type: "email" },
    { label: t.clients.fields.phone, name: "phone" },
    { label: t.clients.fields.website, name: "website" },
    { label: t.clients.fields.address, name: "address", fullWidth: true },
    { label: t.clients.fields.country, name: "country" },
    { label: t.clients.fields.city, name: "city" },
    { label: t.clients.fields.zipCode, name: "zipCode" },
  ];

  const STATUS_OPTIONS: { value: string; label: string }[] = [
    { value: "PROSPECT", label: t.clients.status.PROSPECT },
    { value: "CLIENT", label: t.clients.status.CLIENT },
    { value: "INACTIVE", label: t.clients.status.INACTIVE },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
      {CLIENT_FIELDS.map((field) => (
        <Input
          key={field.name}
          label={field.label}
          name={field.name}
          type={field.type ?? "text"}
          onChange={onChange}
          error={errors}
          value={values[field.name] ?? ""}
          fullWidth={field.fullWidth}
        />
      ))}

      <div className="mb-7 sm:col-span-2">
        <label htmlFor="status" className="mb-2 block text-sm text-gray-500 dark:text-gray-400">{t.clients.fields.status}</label>
        <select
          id="status"
          name="status"
          value={values.status}
          onChange={onChange}
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-gray-900 dark:text-gray-100"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
