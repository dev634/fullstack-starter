'use client'
import { updateClient } from "@/actions/clients/clients";
import { useEffect, useActionState, useState } from 'react';
import { Client } from "@/app/generated/prisma/client";
import { ClientFields } from "@/forms/ClientFields";
import { PhotoUpload } from "@/components/PhotoUpload";
import { Toast } from "@/components/Toast";
import {useRouter} from "next/navigation";
import type { ClientActionState } from "@/types/client";

const initialState: ClientActionState = {
  type: null,
  message: "",
}

export default function UpdateClientForm({ client }: { client: Client }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<ClientActionState, FormData>(
    updateClient,
    initialState
  );
  const [values, setValues] = useState<Client>(client);

  useEffect(() => {
    if (state.type === null) return;
    // Show the result for 3s, then redirect to the clients list.
    const timer = setTimeout(() => {
      router.push("/clients");
    }, 3000);
    return () => clearTimeout(timer);
  }, [state, router]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setValues(prev => ({ ...prev, [name]: value }));
  }

  return (
    <form action={formAction} className="w-full bg-transparent rounded shadow">
      <Toast type={state.type} message={state.message} />
      <input type="hidden" name="id" value={values.id} />
      <PhotoUpload defaultUrl={values.photoUrl} />
      <ClientFields
        values={values}
        onChange={handleChange}
        errors={state.type === "zodError" ? state.fieldsForm : undefined}
      />
      <button
        type="submit"
        disabled={isPending}
        className={`w-full px-4 py-2 bg-blue-500 text-white 
        rounded hover:bg-blue-600 cursor-pointer ${
          isPending ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        Modifier le client
      </button>
    </form>
  );
}   