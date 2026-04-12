import Link from "next/link";
 
type ButtonTypeEnum = "button" | "link" | "submit";
type ButtonProps<T extends ButtonTypeEnum> = T extends "link" ? {
    text: string;
    href: string;
    as?: T;
} : {
    text: string;
    as?: T;
};  

export default function Button({ text , as}: ButtonProps<ButtonTypeEnum>) {
  const buttonType = as === "submit" ? "submit" : "button";
  if (as === "link") {
    return (
      <Link href="#" className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
        {text}
      </Link>
    );
  }
  
  return (
    <button type={buttonType} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
      {text}
    </button>
  );
}