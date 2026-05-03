'use client'
import { addClient } from "@/actions/clients/clients";
import { useEffect, useActionState, useState } from 'react';
import { Client } from "@/app/generated/prisma/client";
import { Input } from "@/components/Inputs";
import { Toast } from "@/components/Toast";


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
    console.log(state)
    if (state.type !== null) {
      setFeedback(state);
      const timer = setTimeout(() => {
        setFeedback(initialState);// Reset form by changing its key
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
      <Input
        label="Firstname"
        name="firstName"
        onChange={handleChange}
        error={feedback.type === "zodError" ? feedback.fieldsForm : undefined}
        value={values.firstName}
      />
      <Input
        label="Lastname"
        name="lastName"
        onChange={handleChange}
        error={feedback.type === "zodError" ? feedback.fieldsForm : undefined}
        value={values.lastName}
      />
      <Input
        label="Email"
        name="email"
        type="email"
        onChange={handleChange}
        error={feedback.type === "zodError" ? feedback.fieldsForm : undefined}
        value={values.email}
      />
      <Input
        label="Company Name"
        name="companyName"
        onChange={handleChange}
        error={feedback.type === "zodError" ? feedback.fieldsForm : undefined}
        value={values.companyName}
      />
      <Input
        label="Address"
        name="address"
        onChange={handleChange}
        error={feedback.type === "zodError" ? feedback.fieldsForm : undefined}
        value={values.address}
      />
      <Input
        label="Country"
        name="country"
        onChange={handleChange}
        error={feedback.type === "zodError" ? feedback.fieldsForm : undefined}
        value={values.country}
      />
      <Input
        label="City"
        name="city"
        onChange={handleChange}
        error={feedback.type === "zodError" ? feedback.fieldsForm : undefined}
        value={values.city}
      />
      <Input
        label="Zip Code"
        name="zipCode"
        onChange={handleChange}
        error={feedback.type === "zodError" ? feedback.fieldsForm : undefined}
        value={values.zipCode}
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