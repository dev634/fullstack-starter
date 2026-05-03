"use server"
import {createClient} from "@/service/clients";
import {formDataToObject} from "@/lib/helpers" ;
import { CreateClientInput } from "@/schemas/client";


export async function addClient(prevState: any, formData: FormData) {
    const clientDatas = formDataToObject(formData) as CreateClientInput;
    
    try {
        const client = await createClient({...clientDatas});
        return {
            ...prevState,
            type: "success",
            message: client.message
        };
    } catch (error) {
        
        if(error && typeof error === "object" && Object.keys(error).includes("type") && Object.keys(error).includes("message") && (error as any).type === "zodError") {
            return {
                ...prevState,
                ...error
            }
        }

        return {
            ...prevState,
            type: "error",
            message: error && typeof error === "object" && "message" in error ? (error as any).message : "Server error adding client."
        };
    }
}
