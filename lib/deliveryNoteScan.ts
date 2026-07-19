import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — well under either provider's image limit
const ACCEPTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type ScannedDeliveryItem = {
    name: string;
    quantity: number;
    unit: string | null;
    reference: string | null;
};

export type ScannedDeliveryNote = {
    // Supplier read from the note header — one per delivery note, applied to
    // every new material created from the scan.
    supplier: string | null;
    items: ScannedDeliveryItem[];
};

type RawItem = { name?: unknown; quantity?: unknown; unit?: unknown; reference?: unknown };
type RawNote = { supplier?: unknown; items?: RawItem[] };

const PROMPT =
    "This is a photo of a delivery note (bulletin de livraison) for a solar installation project. Read the supplier/company name shown on the note (usually in the header), and every delivered line item — for each line record the material/product name, the delivered quantity, the unit if shown, and the product reference/code if shown. Record everything with the record_delivery_items tool. Ignore prices and non-material lines.";

const ITEMS_SCHEMA = {
    type: "object" as const,
    properties: {
        supplier: { type: "string", description: "The supplier / company name shown on the delivery note (usually in the header). Omit if not shown." },
        items: {
            type: "array" as const,
            items: {
                type: "object" as const,
                properties: {
                    name: { type: "string", description: "The material/product name as written on the note." },
                    quantity: { type: "number", description: "The delivered quantity for this line." },
                    unit: { type: "string", description: "The unit, if shown (e.g. pièce, m, kg). Omit if not shown." },
                    reference: { type: "string", description: "The product reference / code for this line, if shown. Omit if not shown." },
                },
                required: ["name", "quantity"],
            },
        },
    },
    required: ["items"],
};

/** Which vision provider to use — same output contract either way, switchable without redeploying code (just the env var). */
function activeProvider(): "anthropic" | "openai" {
    return process.env.OCR_PROVIDER === "openai" ? "openai" : "anthropic";
}

async function extractWithAnthropic(base64: string, mimeType: string): Promise<RawNote> {
    if (!process.env.ANTHROPIC_API_KEY) {
        throw {
            type: "error",
            message: "Delivery note scanning isn't configured (missing ANTHROPIC_API_KEY).",
        };
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const extractItemsTool: Anthropic.Tool = {
        name: "record_delivery_items",
        description: "Records the line items read from a delivery note (bulletin de livraison) photo.",
        input_schema: ITEMS_SCHEMA,
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
                        source: { type: "base64", media_type: mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: base64 },
                    },
                    { type: "text", text: PROMPT },
                ],
            },
        ],
    });

    const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    return (toolUse?.input as RawNote | undefined) ?? {};
}

async function extractWithOpenAI(base64: string, mimeType: string): Promise<RawNote> {
    if (!process.env.OPENAI_API_KEY) {
        throw {
            type: "error",
            message: "Delivery note scanning isn't configured (missing OPENAI_API_KEY).",
        };
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 2048,
        tools: [
            {
                type: "function",
                function: {
                    name: "record_delivery_items",
                    description: "Records the line items read from a delivery note (bulletin de livraison) photo.",
                    parameters: ITEMS_SCHEMA,
                },
            },
        ],
        tool_choice: { type: "function", function: { name: "record_delivery_items" } },
        messages: [
            {
                role: "user",
                content: [
                    { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
                    { type: "text", text: PROMPT },
                ],
            },
        ],
    });

    const toolCall = response.choices[0]?.message.tool_calls?.[0];
    if (!toolCall || toolCall.type !== "function") return {};
    try {
        return JSON.parse(toolCall.function.arguments) as RawNote;
    } catch {
        return {};
    }
}

/**
 * Reads a delivery note photo with a vision LLM and extracts each delivered
 * line item as structured data. Uses tool/function calling (not free-text
 * parsing) so the model is constrained to return exactly this shape — far
 * more reliable than asking for JSON in prose and parsing it after. The
 * provider (Anthropic by default, OpenAI as a fallback) is chosen by the
 * OCR_PROVIDER env var so it can be switched without a code change.
 */
export async function extractDeliveryNoteItems(file: File): Promise<ScannedDeliveryNote> {
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

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");

    const raw =
        activeProvider() === "openai"
            ? await extractWithOpenAI(base64, file.type)
            : await extractWithAnthropic(base64, file.type);

    const supplier = typeof raw.supplier === "string" && raw.supplier.trim() !== "" ? raw.supplier.trim() : null;

    const items = (raw.items ?? [])
        .filter((item) => typeof item.name === "string" && item.name.trim() !== "" && typeof item.quantity === "number")
        .map((item) => ({
            name: (item.name as string).trim(),
            quantity: item.quantity as number,
            unit: typeof item.unit === "string" && item.unit.trim() !== "" ? item.unit.trim() : null,
            reference: typeof item.reference === "string" && item.reference.trim() !== "" ? item.reference.trim() : null,
        }));

    if (items.length === 0) {
        throw {
            type: "error",
            message: "Could not read any items from this delivery note. Try a clearer photo.",
        };
    }

    return { supplier, items };
}
