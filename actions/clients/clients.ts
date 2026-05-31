"use server"
import {createClient} from "@/service/clients";
import {formDataToObject} from "@/lib/helpers" ;
import { CreateClientInput, UpdateClientInput } from "@/schemas/client";
import { findById, remove, update } from "@/repository/clients";


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

export async function getClient(id: number) {
    try {

        if (isNaN(id)) {           
            throw {
                type: "error",
                message: "Invalid client ID."
            }
        }

        const client = await findById(id);
        return {
            type: "success",
            data: client
        };
    } catch (error) {
        console.log("Action getClient error:", error);
        return {
            type: "error",
            message: error && typeof error === "object" && "message" in error ? (error as any).message : "Server error fetching client."
        };
    }
}

export async function updateClient(prevState: any, formData: FormData){
    const clientDatas = formDataToObject(formData) as UpdateClientInput;
    const id = parseInt(clientDatas.id.toString(), 10)
    try {
        if(isNaN(id)){
            throw {
                type: "error",
                message: "Invalid client ID"
            }
        }
        const client = await update(clientDatas);
        return client;
    }catch(error){
        console.log("Action updateClient error:", error);
        return {
            type: "error",
            message: error && typeof error === "object" && "message" in error ? (error as any).message : "Server error adding client."
        };
    }
}

export async function deleteClient(id: number) {
    try {
        if(isNaN(id)){
            throw {
                type: "error",
                message: "Invalid client ID"
            }
        }
        const client = await remove(id);
        return client;
    }catch(error){
        console.log("Action deleteClient error:", error);
        return {
            type: "error",
            message: error && typeof error === "object" && "message" in error ? (error as any).message : "Server error deleting client."
        };
    }
}
