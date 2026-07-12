import { Input } from "@/components/Inputs";

export type ProjectFormValues = {
  name: string;
  status: string;
  power: string;
  budget: string;
  address: string;
  startDate: string;
  endDate: string;
  notes: string;
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "ETUDE", label: "Étude" },
  { value: "SIGNE", label: "Signé" },
  { value: "EN_COURS", label: "En cours" },
  { value: "RACCORDEMENT", label: "Raccordement" },
  { value: "TERMINE", label: "Terminé" },
  { value: "ANNULE", label: "Annulé" },
];

type ProjectFieldsProps = {
  values: ProjectFormValues;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
  errors?: Record<string, string>;
};

export function ProjectFields({ values, onChange, errors }: ProjectFieldsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
      <Input label="Nom du projet" name="name" value={values.name} onChange={onChange} error={errors} fullWidth />

      <div className="mb-7">
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

      <Input label="Puissance (kWc)" name="power" type="number" value={values.power} onChange={onChange} error={errors} />
      <Input label="Budget (€)" name="budget" type="number" value={values.budget} onChange={onChange} error={errors} />
      <Input label="Adresse du chantier" name="address" value={values.address} onChange={onChange} error={errors} fullWidth />

      {/* Native date inputs ignore `placeholder`, so Input's sr-only label
          pattern leaves them looking unlabeled — use a visible label here. */}
      <div className="mb-7">
        <label htmlFor="startDate" className="mb-2 block text-sm text-gray-500 dark:text-gray-400">Date de début</label>
        <input
          id="startDate"
          type="date"
          name="startDate"
          value={values.startDate}
          onChange={onChange}
          className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-gray-900 dark:text-gray-100"
        />
      </div>
      <div className="mb-7">
        <label htmlFor="endDate" className="mb-2 block text-sm text-gray-500 dark:text-gray-400">Date de fin prévue</label>
        <input
          id="endDate"
          type="date"
          name="endDate"
          value={values.endDate}
          onChange={onChange}
          className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-gray-900 dark:text-gray-100"
        />
      </div>

      <div className="mb-7 sm:col-span-2">
        <label htmlFor="notes" className="mb-2 block text-sm text-gray-500 dark:text-gray-400">Notes</label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          value={values.notes}
          onChange={onChange}
          className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-gray-900 dark:text-gray-100 placeholder-gray-500"
          placeholder="Notes"
        />
      </div>
    </div>
  );
}
