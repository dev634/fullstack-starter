"use server"
import {createClient} from "@/service/clients";
import {formDataToObject, deleteFormDataEntries} from "@/lib/helpers" ;
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
        return {
            ...prevState,
            type: "error",
            message: "Error adding client."
        };
    }finally {
        deleteFormDataEntries(formData, Object.keys(clientDatas));
    }
}
