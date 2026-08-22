import { Input } from "@/components/Inputs";
import { useTranslation } from "@/components/LocaleProvider";

export type ProjectFormValues = {
  name: string;
  businessNumber: string;
  type: string;
  status: string;
  power: string;
  budget: string;
  address: string;
  startDate: string;
  endDate: string;
  notes: string;
};

type ProjectFieldsProps = {
  values: ProjectFormValues;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
  errors?: Record<string, string>;
};

export function ProjectFields({ values, onChange, errors }: ProjectFieldsProps) {
  const { t } = useTranslation();

  const TYPE_OPTIONS: { value: string; label: string }[] = [
    { value: "CENTRALE_AU_SOL", label: t.projects.type.CENTRALE_AU_SOL },
    { value: "OMBRIERE", label: t.projects.type.OMBRIERE },
    { value: "TOITURE", label: t.projects.type.TOITURE },
    { value: "AUTRE", label: t.projects.type.AUTRE },
  ];

  const STATUS_OPTIONS: { value: string; label: string }[] = [
    { value: "ETUDE", label: t.projects.status.ETUDE },
    { value: "SIGNE", label: t.projects.status.SIGNE },
    { value: "EN_COURS", label: t.projects.status.EN_COURS },
    { value: "RACCORDEMENT", label: t.projects.status.RACCORDEMENT },
    { value: "TERMINE", label: t.projects.status.TERMINE },
    { value: "ANNULE", label: t.projects.status.ANNULE },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
      <Input label={t.projects.fields.name} name="name" value={values.name} onChange={onChange} error={errors} fullWidth />
      <Input label={t.projects.fields.businessNumber} name="businessNumber" value={values.businessNumber} onChange={onChange} error={errors} fullWidth />

      <div className="mb-7">
        <label htmlFor="type" className="mb-2 block text-sm text-gray-500 dark:text-gray-400">{t.projects.fields.type}</label>
        <select
          id="type"
          name="type"
          value={values.type}
          onChange={onChange}
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-gray-900 dark:text-gray-100"
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="mb-7">
        <label htmlFor="status" className="mb-2 block text-sm text-gray-500 dark:text-gray-400">{t.projects.fields.status}</label>
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

      <Input label={t.projects.fields.power} name="power" type="number" value={values.power} onChange={onChange} error={errors} />
      <Input label={t.projects.fields.budget} name="budget" type="number" value={values.budget} onChange={onChange} error={errors} />
      <Input label={t.projects.fields.address} name="address" value={values.address} onChange={onChange} error={errors} fullWidth />

      {/* Native date inputs ignore `placeholder`, so Input's sr-only label
          pattern leaves them looking unlabeled — use a visible label here. */}
      <div className="mb-7">
        <label htmlFor="startDate" className="mb-2 block text-sm text-gray-500 dark:text-gray-400">{t.projects.fields.startDate}</label>
        <input
          id="startDate"
          type="date"
          name="startDate"
          value={values.startDate}
          onChange={onChange}
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-gray-900 dark:text-gray-100"
        />
      </div>
      <div className="mb-7">
        <label htmlFor="endDate" className="mb-2 block text-sm text-gray-500 dark:text-gray-400">{t.projects.fields.endDate}</label>
        <input
          id="endDate"
          type="date"
          name="endDate"
          value={values.endDate}
          onChange={onChange}
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-gray-900 dark:text-gray-100"
        />
      </div>

      <div className="mb-7 sm:col-span-2">
        <label htmlFor="notes" className="mb-2 block text-sm text-gray-500 dark:text-gray-400">{t.projects.fields.notes}</label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          value={values.notes}
          onChange={onChange}
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-gray-900 dark:text-gray-100 placeholder-gray-500"
          placeholder={t.projects.fields.notes}
        />
        {/* `Input` (used by the fields above) already renders `errors[name]`
            for a plain <input> — a <textarea> isn't one, so notes (free text,
            MAX_NOTE_LENGTH) needs its own error line the same way. */}
        {typeof errors === "object" && errors?.notes && (
          <p className="text-start text-red-500 mb-6" aria-live="polite">{errors.notes}</p>
        )}
      </div>
    </div>
  );
}
