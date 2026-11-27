import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The modal's hooks are replaced by a positional store (no DOM library here): `useState` returns
// the seeded value for its call position and records every setter call, `useTransition` runs the
// callback at once and keeps its promise so the test can await it.
const harness = vi.hoisted(() => ({
  seeds: [] as unknown[],
  setters: [] as Array<ReturnType<typeof vi.fn>>,
  transitions: [] as Array<Promise<void>>,
  refresh: vi.fn(),
  apply: vi.fn(),
  position: 0,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: () => ({ current: null }),
    useState: (initial: unknown) => {
      const i = harness.position++;
      const value = i in harness.seeds ? harness.seeds[i] : initial;
      const setter = vi.fn();
      harness.setters[i] = setter;
      return [value, setter];
    },
    useTransition: () => [
      false,
      (fn: () => Promise<void>) => {
        harness.transitions.push(fn());
      },
    ],
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: harness.refresh }) }));
// The real French dictionary: the labels asserted below are the ones users read.
vi.mock("@/components/LocaleProvider", async () => {
  const { getDictionary } = await import("@/lib/i18n/dictionaries");
  return { useTranslation: () => ({ t: getDictionary("fr") }) };
});
vi.mock("@/actions/deliveryNoteScan/deliveryNoteScan", () => ({
  scanDeliveryNote: vi.fn(),
  applyDeliveryNoteScan: harness.apply,
}));

import ScanDeliveryNoteModal from "@/components/ScanDeliveryNoteModal";
import { ScanApplyWarning } from "@/components/ScanApplyWarning";

const WARNING =
  "Matériaux appliqués. L'archive du bulletin dépassait la taille de stockage (10 Mo) et n'a pas été enregistrée.";

// Hook order in the modal: open, file, rows, supplier, confirming, error, warning.
const I = { open: 0, file: 1, rows: 2, confirming: 4, error: 5, warning: 6 };

function seed(over: Record<number, unknown>): void {
  harness.seeds = [];
  for (const [k, v] of Object.entries(over)) harness.seeds[Number(k)] = v;
  harness.position = 0;
  harness.setters.length = 0;
}

function render(): ReactNode {
  harness.position = 0;
  return ScanDeliveryNoteModal({ clientId: 1, projectId: 2, materials: [] });
}

type ButtonProps = { children?: ReactNode; onClick?: () => void };

function findButton(node: ReactNode, label: string): ButtonProps | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findButton(child, label);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement<ButtonProps>(node)) return null;
  if (node.type === "button" && JSON.stringify(node.props.children).includes(label)) return node.props;
  return findButton(node.props.children, label);
}

const ROW = { name: "x", brand: "B", reference: "R", quantity: 2, materialId: null };
const REVIEWED = () => ({
  [I.open]: true,
  [I.file]: new File(["x"], "n.jpg"),
  [I.rows]: [ROW],
  [I.confirming]: true,
});

beforeEach(() => {
  harness.refresh.mockReset();
  harness.apply.mockReset();
  harness.transitions.length = 0;
});

describe("ScanApplyWarning", () => {
  it("renders the message in a status region", () => {
    const html = renderToStaticMarkup(createElement(ScanApplyWarning, { message: WARNING }));
    expect(html).toContain('role="status"');
    expect(html).toContain("taille de stockage (10 Mo)");
  });
});

describe("ScanDeliveryNoteModal — apply answered with a warning", () => {
  it("refreshes the page data and keeps the message; neither closes nor reports an error", async () => {
    harness.apply.mockResolvedValue({ type: "warning", message: WARNING });
    seed(REVIEWED());
    const confirm = findButton(render(), "Confirmer et mettre à jour");
    expect(confirm?.onClick).toBeDefined();
    confirm?.onClick?.();
    await Promise.all(harness.transitions);

    expect(harness.refresh).toHaveBeenCalledTimes(1);
    expect(harness.setters[I.warning]).toHaveBeenCalledWith(WARNING);
    expect(harness.setters[I.error]).not.toHaveBeenCalledWith(WARNING);
    // `close()` would have set `open` to false.
    expect(harness.setters[I.open]).not.toHaveBeenCalled();
  });

  it("once the warning is set, only a Close button is offered: no way to apply again", () => {
    seed({ ...REVIEWED(), [I.warning]: WARNING });
    const tree = render();
    expect(findButton(tree, "Fermer")).not.toBeNull();
    expect(findButton(tree, "Confirmer et mettre à jour")).toBeNull();
    expect(findButton(tree, "Mettre à jour le stock")).toBeNull();
    expect(findButton(tree, "Retour")).toBeNull();
    expect(findButton(tree, "Annuler")).toBeNull();
    const html = renderToStaticMarkup(tree as Parameters<typeof renderToStaticMarkup>[0]);
    expect(html).toContain('role="status"');
    expect(html).toContain("taille de stockage (10 Mo)");
  });

  it("a plain success still closes and refreshes; an error still shows as an error", async () => {
    harness.apply.mockResolvedValue({ type: "success", message: "ok" });
    seed(REVIEWED());
    findButton(render(), "Confirmer et mettre à jour")?.onClick?.();
    await Promise.all(harness.transitions);
    expect(harness.setters[I.open]).toHaveBeenCalledWith(false);
    expect(harness.refresh).toHaveBeenCalledTimes(1);

    harness.apply.mockResolvedValue({ type: "error", message: "boom" });
    harness.refresh.mockReset();
    seed(REVIEWED());
    findButton(render(), "Confirmer et mettre à jour")?.onClick?.();
    await Promise.all(harness.transitions);
    expect(harness.setters[I.error]).toHaveBeenCalledWith("boom");
    expect(harness.refresh).not.toHaveBeenCalled();
  });
});
