type InputTypeEnum = "text" | "email" | "password" | "number";

export type InputProps = {
    label: string;
    name: string;
    type?: InputTypeEnum;
    error?: Record<string, string>;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}