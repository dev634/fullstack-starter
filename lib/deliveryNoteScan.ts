import Anthropic from "@anthropic-ai/sdk";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — well under Claude's image limit
const ACCEPTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type ScannedDeliveryItem = {
    name: string;
    quantity: number;
    unit: string | null;
};

/**
 * Reads a delivery note photo with Claude's vision API and extracts each
 * delivered line item as structured data. Uses tool-use (not free-text
 * parsing) so the model is constrained to return exactly this shape —
 * far more reliable than asking for JSON in prose and parsing it after.
 */
export async function extractDeliveryNoteItems(file: File): Promise<ScannedDeliveryItem[]> {
    if (!ACCEPTED_MIME_TYPES.has(file.type)) {
        throw {
            type: "error",
            message: "The delivery note must be a JPEG, PNG, WEBP or GIF photo.",
        };
    }
    if (file.size > MAX_BYTES) {
        throw {
            type: "error",
            message: "The delivery note photo must be 10 MB or smaller.",
        };
    }
    if (!process.env.ANTHROPIC_API_KEY) {
        throw {
            type: "error",
            message: "Delivery note scanning isn't configured (missing ANTHROPIC_API_KEY).",
        };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const extractItemsTool: Anthropic.Tool = {
        name: "record_delivery_items",
        description: "Records the line items read from a delivery note (bulletin de livraison) photo.",
        input_schema: {
            type: "object",
            properties: {
                items: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string", description: "The material/product name as written on the note." },
                            quantity: { type: "number", description: "The delivered quantity for this line." },
                            unit: { type: "string", description: "The unit, if shown (e.g. pièce, m, kg). Omit if not shown." },
                        },
                        required: ["name", "quantity"],
                    },
                },
            },
            required: ["items"],
        },
    };

    const message = await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 2048,
        tools: [extractItemsTool],
        tool_choice: { type: "tool", name: "record_delivery_items" },
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "image",
                        source: { type: "base64", media_type: file.type as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: base64 },
                    },
                    {
                        type: "text",
                        text: "This is a photo of a delivery note (bulletin de livraison) for a solar installation project. Read every delivered line item (material name, quantity, and unit if shown) and record them with the record_delivery_items tool. Ignore prices, references, and non-material lines.",
                    },
                ],
            },
        ],
    });

    const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    if (!toolUse) {
        throw {
            type: "error",
            message: "Could not read any items from this delivery note. Try a clearer photo.",
        };
    }

    const input = toolUse.input as { items?: { name?: unknown; quantity?: unknown; unit?: unknown }[] };
    const items = (input.items ?? [])
        .filter((item) => typeof item.name === "string" && item.name.trim() !== "" && typeof item.quantity === "number")
        .map((item) => ({
            name: (item.name as string).trim(),
            quantity: item.quantity as number,
            unit: typeof item.unit === "string" && item.unit.trim() !== "" ? item.unit.trim() : null,
        }));

    if (items.length === 0) {
        throw {
            type: "error",
            message: "Could not read any items from this delivery note. Try a clearer photo.",
        };
    }

    return items;
}
