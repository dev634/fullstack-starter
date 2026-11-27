import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";

// No DOM library in this repo: the hooks are replaced so the component function can be called
// directly. `useEffect` callbacks are collected and run by hand, which is what lets fake timers
// prove whether a redirect is scheduled.
const harness = vi.hoisted(() => ({
  state: { type: null, message: "" } as { type: string | null; message: string },
  effects: [] as Array<() => void | (() => void)>,
  push: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (fn: () => void | (() => void)) => {
      harness.effects.push(fn);
    },
    useState: <T,>(initial: T) => [initial, vi.fn()],
    useActionState: () => [harness.state, vi.fn(), false],
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: harness.push }) }));
vi.mock("@/components/LocaleProvider", () => ({
  useTranslation: () => ({ t: { clients: { addSubmit: "Ajouter", updateSubmit: "Enregistrer" } } }),
}));
vi.mock("@/actions/clients/clients", () => ({ addClient: vi.fn(), updateClient: vi.fn() }));
vi.mock("@/forms/ClientFields", () => ({ ClientFields: () => null }));
vi.mock("@/components/PhotoUpload", () => ({ PhotoUpload: () => null }));
vi.mock("@/components/Toast", () => ({ Toast: () => null }));

import AddClientForm from "@/forms/AddClientForm";
import UpdateClientForm from "@/forms/UpdateClientForm";
import type { UpdateClientFormValues } from "@/forms/updateClientFormValues";

const CLIENT = { id: 1 } as unknown as UpdateClientFormValues;

const FORMS: Array<[string, () => ReactNode]> = [
  ["AddClientForm", () => AddClientForm()],
  ["UpdateClientForm", () => UpdateClientForm({ client: CLIENT })],
];

function runEffects(): void {
  for (const effect of harness.effects) effect();
}

describe.each(FORMS)("%s — redirects to /clients only after a success", (_name, render) => {
  beforeEach(() => {
    vi.useFakeTimers();
    harness.effects.length = 0;
    harness.push.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it.each(["error", "zodError", null])("state %s: no redirect, even after the delay", (type) => {
    harness.state = { type, message: "x" };
    render();
    runEffects();
    vi.advanceTimersByTime(60_000);
    expect(harness.push).not.toHaveBeenCalled();
  });

  it("state success: redirects after the delay, not before", () => {
    harness.state = { type: "success", message: "ok" };
    render();
    runEffects();
    vi.advanceTimersByTime(2_999);
    expect(harness.push).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(harness.push).toHaveBeenCalledWith("/clients");
  });
});
