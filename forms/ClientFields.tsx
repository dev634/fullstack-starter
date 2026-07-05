import { Client } from "@/app/generated/prisma/client";
import { Input } from "@/components/Inputs";

const CLIENT_FIELDS: {
  label: string;
  name: keyof Omit<Client, "id" | "photoUrl" | "status" | "deletedAt">;
  type?: "text" | "email";
  fullWidth?: boolean;
}[] = [
  { label: "Firstname", name: "firstName" },
  { label: "Lastname", name: "lastName" },
  { label: "Email", name: "email", type: "email", fullWidth: true },
  { label: "Company Name", name: "companyName", fullWidth: true },
  { label: "Phone", name: "phone" },
  { label: "Website", name: "website" },
  { label: "Address", name: "address", fullWidth: true },
  { label: "Country", name: "country" },
  { label: "City", name: "city" },
  { label: "Zip Code", name: "zipCode" },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "PROSPECT", label: "Prospect" },
  { value: "CLIENT", label: "Client" },
  { value: "INACTIVE", label: "Inactif" },
];

type ClientFieldsProps = {
  values: Omit<Client, "id" | "photoUrl" | "deletedAt">;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  errors?: Record<string, string>;
};

export function ClientFields({ values, onChange, errors }: ClientFieldsProps) {
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
        <label htmlFor="status" className="mb-2 block text-sm text-gray-500 dark:text-gray-400">Statut</label>
        <select
          id="status"
          name="status"
          value={values.status}
          onChange={onChange}
          className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-gray-900 dark:text-gray-100"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
