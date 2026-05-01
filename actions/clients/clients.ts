"use server"
import {createClient} from "@/service/clients";

export async function addClient(prevState: any, formData: FormData) {
    const firstName = formData.get("firstName") as string;
    const lastName = formData.get("lastName") as string;
    const email = formData.get("email") as string;
    const companyName = formData.get("companyName") as string;
    const address = formData.get("address") as string;
    const city = formData.get("city") as string;
    const zipCode = formData.get("zipCode") as string;
    const country = formData.get("country") as string;
    try {
        const client = await createClient({
            firstName,
            lastName,
            email,
            companyName,
            address,
            city,
            zipCode,
            country
        });
        return {
            ...prevState,
            type: "success",
            message: client.message
        };
    } catch (error) {
        return {
            ...prevState,
            type: "error",
            message: "Error adding client."
        };
    }finally {
        formData.delete("firstName");
        formData.delete("lastName");
        formData.delete("email");
        formData.delete("companyName");
        formData.delete("address"); 
        formData.delete("city");
        formData.delete("zipCode");
        formData.delete("country");   
    }
}