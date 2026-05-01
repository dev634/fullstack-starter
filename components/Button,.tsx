import Link from "next/link";

type ButtonTypeEnum = "button" | "link" | "submit";
type ButtonProps<T extends ButtonTypeEnum> = T extends "link"
  ? {
      text: string;
      href: string;
      as?: T;
    }
  : {
      text: string;
      as?: T;
    };
export default function Button(props: ButtonProps<ButtonTypeEnum>) {
  const buttonType = props.as === "submit" ? "submit" : "button";
  if (props.as === "link") {
    return (
      <Link
        href={props.href || ""}
        className="block w-full px-4 py-3 bg-blue-500 text-white 
        rounded hover:bg-blue-600 text-center text-decoration-none"
      >
        {props.text}
      </Link>
    );
  }

  return (
    <button
      type={buttonType}
      className="block w-full px-4 py-3 bg-blue-500 text-white 
      rounded hover:bg-blue-600 text-center text-decoration-none"
    >
      {props.text}
    </button>
  );
}
