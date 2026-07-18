import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const anthropicCreateMock = vi.fn();
const openaiCreateMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: anthropicCreateMock };
  },
}));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: openaiCreateMock } };
  },
}));

import { extractDeliveryNoteItems } from "@/lib/deliveryNoteScan";

function fileOf(): File {
  return new File(["fake image bytes"], "note.jpg", { type: "image/jpeg" });
}

const originalEnv = { ...process.env };

describe("extractDeliveryNoteItems provider switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses Anthropic by default", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    delete process.env.OCR_PROVIDER;
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: "tool_use", input: { items: [{ name: "Panneau", quantity: 5 }] } }],
    });
    const items = await extractDeliveryNoteItems(fileOf());
    expect(anthropicCreateMock).toHaveBeenCalled();
    expect(openaiCreateMock).not.toHaveBeenCalled();
    expect(items).toEqual([{ name: "Panneau", quantity: 5, unit: null }]);
  });

  it("rejects when OCR_PROVIDER is anthropic (default) but ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OCR_PROVIDER;
    await expect(extractDeliveryNoteItems(fileOf())).rejects.toMatchObject({
      message: expect.stringContaining("ANTHROPIC_API_KEY"),
    });
    expect(anthropicCreateMock).not.toHaveBeenCalled();
  });

  it("switches to OpenAI when OCR_PROVIDER=openai", async () => {
    process.env.OCR_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    openaiCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: "function",
                function: { name: "record_delivery_items", arguments: JSON.stringify({ items: [{ name: "Onduleur", quantity: 3, unit: "pièce" }] }) },
              },
            ],
          },
        },
      ],
    });
    const items = await extractDeliveryNoteItems(fileOf());
    expect(openaiCreateMock).toHaveBeenCalled();
    expect(anthropicCreateMock).not.toHaveBeenCalled();
    expect(items).toEqual([{ name: "Onduleur", quantity: 3, unit: "pièce" }]);
  });

  it("rejects when OCR_PROVIDER=openai but OPENAI_API_KEY is missing", async () => {
    process.env.OCR_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    await expect(extractDeliveryNoteItems(fileOf())).rejects.toMatchObject({
      message: expect.stringContaining("OPENAI_API_KEY"),
    });
    expect(openaiCreateMock).not.toHaveBeenCalled();
  });

  it("rejects an unsupported file type before calling any provider", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const pdf = new File(["fake"], "note.pdf", { type: "application/pdf" });
    await expect(extractDeliveryNoteItems(pdf)).rejects.toMatchObject({
      message: expect.stringContaining("JPEG, PNG, WEBP or GIF"),
    });
    expect(anthropicCreateMock).not.toHaveBeenCalled();
    expect(openaiCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when no items could be read", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    anthropicCreateMock.mockResolvedValue({ content: [{ type: "tool_use", input: { items: [] } }] });
    await expect(extractDeliveryNoteItems(fileOf())).rejects.toMatchObject({
      message: expect.stringContaining("Could not read any items"),
    });
  });
});
