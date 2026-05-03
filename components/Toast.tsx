

export function Toast({
  type,
  message,
}: {
  type: "success" | "error" | "zodError" | null;
  message: string; 
}) {
  return (
    <div
      className={`fixed top-14 right-5 left-5 px-4 py-2 rounded shadow
             ${
               type === "success"
                 ? "bg-green-500 text-black"
                 : type === "error" || type === "zodError" 
                 ? "bg-red-500"
                 : "bg-transparent pointer-events-none"
             } text-center`}
      aria-live="assertive"
    >
      {typeof message === "string" && message }
    </div>
  );
}