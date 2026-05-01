'use client'
import { addClient } from "@/actions/clients/clients";
import { useEffect, useActionState, useState } from 'react';
import Form from 'next/form';


type AddClientFormState = {
  type: "success" | "error" | null;
  message: string
}

const initialState: AddClientFormState = {
  type: null,
  message: "",
}

export default function AddClientForm() {
  const [state, formAction, isPending] = useActionState<AddClientFormState, FormData>(
    addClient,
    initialState
  );
  const [isVisible, setIsVisible] = useState<boolean>(state && state.type !== null);  


  useEffect(() => {
    if (state.type) {
      setIsVisible(true);
      const timer = setTimeout(() => { 
        setIsVisible(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [state]);

  return (
    <Form action={formAction} className="w-full bg-transparent rounded shadow">
      <input type="text" name="firstName" placeholder="Firstname" className="w-full mb-7 p-2 border rounded text-black bg-white" />

      <input type="text" name="lastName" placeholder="Lastname" className="w-full mb-7 p-2 border rounded text-black bg-white" />
      <input type="email" name="email" placeholder="Email" className="w-full mb-7 p-2 border rounded text-black bg-white" />
      <input type="text" name="companyName" placeholder="Company Name" className="w-full mb-7 p-2 border rounded text-black bg-white" />
      <input type="text" name="address" placeholder="Address" className="w-full mb-7 p-2 border rounded text-black bg-white" />
      <input type="text" name="city" placeholder="City" className="w-full mb-7 p-2 border rounded text-black bg-white" />
      <input type="text" name="zipCode" placeholder="Zip code" className="w-full mb-7 p-2 border rounded text-black bg-white" />
      <input type="text" name="country" placeholder="Country" className="w-full mb-7 p-2 border rounded text-black bg-white" />
      {isVisible && <p className={`text-center ${state.type === "success" ? "text-green-500" : "text-red-500"} mb-6`} aria-live="polite">
        {state.message}
      </p>}
      <button type="submit" disabled={isPending} className={`w-full px-4 py-2 bg-blue-500 text-white 
        rounded hover:bg-blue-600 cursor-pointer ${isPending ? "opacity-50 cursor-not-allowed" : ""}`}>
        Add Client
      </button>
    </Form>
  );
}   