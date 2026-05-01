"use server"
import { prisma } from "@/lib/prisma";

export async function addClient(prevState: any, formData: FormData) {
    const firstName = formData.get("firstName") as string;
    const lastName = formData.get("lastName") as string;
    const email = formData.get("email") as string;
    const companyName = formData.get("companyName") as string;
    const address = formData.get("address") as string;
    const city = formData.get("city") as string;
    const zipCode = formData.get("zipCode") as string;
    const country = formData.get("country") as string;
    try{
        const client = await prisma.client.create({
            data: {
                firstName,
                lastName,
                email,
                companyName,
                address,
                city,
                zipCode,
                country
            }
        });   
        console.log("Client created:", client); 
        return {
            ...prevState,
            type: "success",
            message: "Client added successfully!"
        }
    }catch(error){
        console.error("Error creating client:", error);
        return {
            ...prevState,
            type: "error",
            message: "Error adding client."
        }
    }finally {
        await prisma.$disconnect();
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