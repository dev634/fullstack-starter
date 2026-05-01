import React from "react";

export default function Title({ title, as }: { title: string, as?: React.ElementType }) {
  const Heading = as || "h1";
  return (
    <Heading className="text-3xl font-bold mb-6">{title}</Heading>
  );
}