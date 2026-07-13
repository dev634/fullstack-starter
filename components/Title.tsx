import React from "react";

export default function Title({ title, as, className }: { title: string, as?: React.ElementType, className?: string }) {
  const Heading = as || "h1";
  return (
    <Heading className={className ?? "text-3xl font-bold mb-6"}>{title}</Heading>
  );
}