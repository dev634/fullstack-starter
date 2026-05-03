
import { InputProps } from '@/types/inputs';


export function Input({label, name, type = "text", error, value, onChange}:InputProps) {
    return (
        <div key={name} className="mb-7">
            <input
                type={type}
                name={name}
                placeholder={label}
                className="w-full mb-2 p-2 border rounded text-black bg-white"
                value={value}
                onChange={onChange}
            />
            {typeof error === "object" && error[name] && (
                <p className="text-start text-red-500 mb-6" aria-live="polite">
                    {error[name]}
                </p>
            )}
        </div>
    );
}