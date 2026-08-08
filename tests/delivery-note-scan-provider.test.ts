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
import { realJpegFile as fileOf } from "@/tests/helpers/sharpFixtures";

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
      content: [{ type: "tool_use", input: { supplier: "Rexel", items: [{ brand: "Nexans", quantity: 5, reference: "REF-123" }] } }],
    });
    const note = await extractDeliveryNoteItems(await fileOf());
    expect(anthropicCreateMock).toHaveBeenCalled();
    expect(openaiCreateMock).not.toHaveBeenCalled();
    expect(note).toEqual({
      supplier: "Rexel",
      items: [{ name: "Nexans — REF-123", brand: "Nexans", quantity: 5, reference: "REF-123" }],
      bytesSent: expect.any(Number),
    });
  });

  it("rejects when OCR_PROVIDER is anthropic (default) but ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OCR_PROVIDER;
    // A stable code, never a message naming the environment variable: telling
    // any EDITOR which provider is wired and that its key is missing helps
    // nobody who could act on it. The cause goes to the server log instead;
    // the caller (actions/deliveryNoteScan/deliveryNoteScan.ts) translates
    // this code via the dictionary, never relays it raw.
    await expect(extractDeliveryNoteItems(await fileOf())).rejects.toMatchObject({
      code: "unavailable",
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
                function: { name: "record_delivery_items", arguments: JSON.stringify({ items: [{ brand: "Schneider", quantity: 3 }] }) },
              },
            ],
          },
        },
      ],
    });
    const note = await extractDeliveryNoteItems(await fileOf());
    expect(openaiCreateMock).toHaveBeenCalled();
    expect(anthropicCreateMock).not.toHaveBeenCalled();
    expect(note).toEqual({
      supplier: null,
      items: [{ name: "Schneider", brand: "Schneider", quantity: 3, reference: null }],
      bytesSent: expect.any(Number),
    });
  });

  it("rejects when OCR_PROVIDER=openai but OPENAI_API_KEY is missing", async () => {
    process.env.OCR_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    await expect(extractDeliveryNoteItems(await fileOf())).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(openaiCreateMock).not.toHaveBeenCalled();
  });

  it("rejects an unsupported file type before calling any provider", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const pdf = new File(["fake"], "note.pdf", { type: "application/pdf" });
    await expect(extractDeliveryNoteItems(pdf)).rejects.toMatchObject({
      code: "invalidFileType",
    });
    expect(anthropicCreateMock).not.toHaveBeenCalled();
    expect(openaiCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when no items could be read", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    anthropicCreateMock.mockResolvedValue({ content: [{ type: "tool_use", input: { items: [] } }] });
    await expect(extractDeliveryNoteItems(await fileOf())).rejects.toMatchObject({
      code: "noItemsRead",
    });
  });
});
