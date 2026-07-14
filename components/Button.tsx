"use client";

import Link from "next/link";

type ButtonLinkProps = {
  as: "link";
  text: string;
  href: string;
  classes?: string;
};

type ButtonButtonProps = {
  as?: "button" | "submit";
  text: string;
  classes?: string;
  onClick?: () => void;
};

type ButtonProps = ButtonLinkProps | ButtonButtonProps;

export default function Button(props: ButtonProps) {
  const defaultClasses =
    "block w-full px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 text-center no-underline";

  if (props.as === "link") {
    return (
      <Link
        href={props.href}
        className={props.classes ?? defaultClasses}
      >
        {props.text}
      </Link>
    );
  }

  return (
    <button
      type={props.as === "submit" ? "submit" : "button"}
      className={props.classes ?? defaultClasses}
      onClick={props.onClick}
    >
      {props.text}
    </button>
  );
}