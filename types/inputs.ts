type InputTypeEnum = "text" | "email" | "password" | "number";

export type InputProps = {
    label: string;
    name: string;
    type?: InputTypeEnum;
    error?: Record<string, string>;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    /** Span both columns when rendered inside a 2-column grid. */
    fullWidth?: boolean;
}