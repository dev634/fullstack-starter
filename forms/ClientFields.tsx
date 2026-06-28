import { Client } from "@/app/generated/prisma/client";
import { Input } from "@/components/Inputs";

const CLIENT_FIELDS: {
  label: string;
  name: keyof Omit<Client, "id">;
  type?: "text" | "email";
  fullWidth?: boolean;
}[] = [
  { label: "Firstname", name: "firstName" },
  { label: "Lastname", name: "lastName" },
  { label: "Email", name: "email", type: "email", fullWidth: true },
  { label: "Company Name", name: "companyName", fullWidth: true },
  { label: "Address", name: "address", fullWidth: true },
  { label: "Country", name: "country" },
  { label: "City", name: "city" },
  { label: "Zip Code", name: "zipCode" },
];

type ClientFieldsProps = {
  values: Omit<Client, "id">;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  errors?: Partial<Omit<Client, "id">>;
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
          value={values[field.name]}
          fullWidth={field.fullWidth}
        />
      ))}
    </div>
  );
}
