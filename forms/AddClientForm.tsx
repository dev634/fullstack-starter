'use client'
import { addClient } from "@/actions/clients/clients";
import { useEffect, useActionState, useState } from 'react';
import { Client } from "@/app/generated/prisma/client";
import { ClientFields } from "@/forms/ClientFields";
import { Toast } from "@/components/Toast";
import {useRouter} from "next/navigation";


type AddClientFormState =
  | { type: "success"; message: string }
  | { type: "error"; message: string }
  | { type: "zodError"; message: string; fieldsForm: Partial<Omit<Client, "id">>}
  | { type: null; message: string };

const initialState: AddClientFormState = {
  type: null,
  message: "",
}

export default function AddClientForm() {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<AddClientFormState, FormData>(
    addClient,
    initialState
  );
  const [values, setValues] = useState<Omit<Client, "id">>({
    firstName: "",
    lastName: "",
    email: "",
    companyName: "",
    address: "",
    country: "",
    city: "",
    zipCode: ""
  });
  const [feedback, setFeedback] = useState<AddClientFormState>(initialState);

  useEffect(() => {
    if (state.type !== null) {
      setFeedback(state);
      const timer = setTimeout(() => {
        setFeedback(initialState);// Reset form by changing its key
        router.push("/clients"); // Redirect to clients list after adding a client
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [state]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setValues(prev => ({ ...prev, [name]: value }));
  }

  return (
    <form action={formAction} className="w-full bg-transparent rounded shadow">
      <Toast type={feedback.type} message={feedback.message} />
      <ClientFields
        values={values}
        onChange={handleChange}
        errors={feedback.type === "zodError" ? feedback.fieldsForm : undefined}
      />
      <button
        type="submit"
        disabled={isPending}
        className={`w-full px-4 py-2 bg-blue-500 text-white 
        rounded hover:bg-blue-600 cursor-pointer ${
          isPending ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        Add Client
      </button>
    </form>
  );
}   