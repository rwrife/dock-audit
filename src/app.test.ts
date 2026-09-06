import {
  fireEvent,
  getByLabelText,
  getByRole,
  waitFor,
} from "@testing-library/dom";
import * as axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  type DeviceClass,
  type DockAuditBackend,
  type InventoryReport,
  type Observation,
  compareProfileFallback,
  createDockAuditApp,
  createMemoryStorage,
} from "./app";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function observation(
  deviceClass: DeviceClass,
  label: string,
  identityHashes: Record<string, string> = {},
): Observation {
  return {
    class: deviceClass,
    label,
    attributes: {
      stable_vendor: {
        value: "acme",
        source: "fixture",
        stable: true,
      },
    },
    capabilities: {
      fixture: {
        source: "fixture",
        stable: true,
      },
    },
    identity_hashes: identityHashes,
  };
}

function report(
  observations: Observation[],
  overrides: Partial<InventoryReport["scan_health"]> = {},
): InventoryReport {
  return {
    observations,
    scan_health: {
      usb: "complete",
      display: "complete",
      audio_input: "complete",
      audio_output: "complete",
      network: "complete",
      ...overrides,
    },
    capability_gaps: [],
  };
}

function backendFromScans(scans: InventoryReport[]): DockAuditBackend {
  let index = 0;
  return {
    async scanInventory(): Promise<InventoryReport> {
      const chosen = scans[Math.min(index, scans.length - 1)];
      index += 1;
      return clone(chosen ?? report([]));
    },
    async compareProfile(profile, scanReport) {
      return compareProfileFallback(profile, scanReport);
    },
  };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  fireEvent.input(input);
}

describe("Dock Audit issue #5 workflow", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("captures first observations into a named profile", async () => {
    const root = document.createElement("main");
    document.body.append(root);

    const app = createDockAuditApp(root, {
      backend: backendFromScans([
        report([
          observation("usb", "Dock Keyboard", { serial_hash: "hash-keyboard" }),
        ]),
      ]),
      storage: createMemoryStorage(),
      progressIntervalMs: 1,
    });

    await app.waitForIdle();

    setInputValue(
      getByLabelText(root, "Profile name") as HTMLInputElement,
      "Home desk",
    );
    fireEvent.click(getByLabelText(root, "Dock Keyboard (usb)"));
    setInputValue(
      root.querySelector<HTMLInputElement>("#alias-0")!,
      "Desk keyboard",
    );
    fireEvent.click(getByRole(root, "button", { name: "Save profile" }));

    expect(root.textContent).toContain("Saved profile");
    expect(
      getByRole(root, "combobox", { name: "Selected profile" }),
    ).toBeTruthy();
    expect(root.textContent).toContain("Home desk");
  });

  it("reports a successful reconnect as present", async () => {
    const root = document.createElement("main");
    document.body.append(root);

    const stableDisplay = observation("display", "Desk Display", {
      edid: "hash-display-1",
    });

    const app = createDockAuditApp(root, {
      backend: backendFromScans([
        report([stableDisplay]),
        report([stableDisplay]),
      ]),
      storage: createMemoryStorage(),
      progressIntervalMs: 1,
    });

    await app.waitForIdle();

    setInputValue(
      getByLabelText(root, "Profile name") as HTMLInputElement,
      "Reconnect profile",
    );
    fireEvent.click(getByLabelText(root, "Desk Display (display)"));
    fireEvent.click(getByRole(root, "button", { name: "Save profile" }));

    fireEvent.click(getByRole(root, "button", { name: "Check desk" }));

    await waitFor(() => {
      expect(root.textContent).toContain("Present (1)");
    });

    expect(root.textContent).toContain("A stable local identity hash matched.");
    expect(root.textContent).toContain("Missing 0 (0 required)");
  });

  it("blocks missing-device claims when scan health is partial", async () => {
    const root = document.createElement("main");
    document.body.append(root);

    const app = createDockAuditApp(root, {
      backend: backendFromScans([
        report([
          observation("display", "Desk Display", {
            edid: "hash-display",
          }),
        ]),
        report([], {
          display: "partial",
        }),
      ]),
      storage: createMemoryStorage(),
      progressIntervalMs: 1,
    });

    await app.waitForIdle();

    setInputValue(
      getByLabelText(root, "Profile name") as HTMLInputElement,
      "Partial scan profile",
    );
    fireEvent.click(getByLabelText(root, "Desk Display (display)"));
    fireEvent.click(getByRole(root, "button", { name: "Save profile" }));

    fireEvent.click(getByRole(root, "button", { name: "Check desk" }));

    await waitFor(() => {
      expect(root.textContent).toContain("Unknown (1)");
    });

    expect(root.textContent).toContain("not scanned completely");
    expect(root.textContent).not.toContain(
      "No matching observation was found in a complete scan.",
    );
  });

  it("surfaces ambiguous friendly-name matches for user review", async () => {
    const root = document.createElement("main");
    document.body.append(root);

    const app = createDockAuditApp(root, {
      backend: backendFromScans([
        report([observation("display", "Mirror Monitor")]),
        report([
          observation("display", "Mirror Monitor"),
          observation("display", "Mirror Monitor"),
        ]),
      ]),
      storage: createMemoryStorage(),
      progressIntervalMs: 1,
    });

    await app.waitForIdle();

    setInputValue(
      getByLabelText(root, "Profile name") as HTMLInputElement,
      "Ambiguity profile",
    );
    fireEvent.click(getByLabelText(root, "Mirror Monitor (display)"));
    fireEvent.click(getByRole(root, "button", { name: "Save profile" }));

    fireEvent.click(getByRole(root, "button", { name: "Check desk" }));

    await waitFor(() => {
      expect(root.textContent).toContain("Ambiguous (1)");
    });

    expect(root.textContent).toContain(
      "More than one observation shared a friendly-name signal.",
    );
  });

  it("keeps optional missing devices out of required-missing counts", async () => {
    const root = document.createElement("main");
    document.body.append(root);

    const app = createDockAuditApp(root, {
      backend: backendFromScans([
        report([
          observation("usb", "Optional Webcam", { serial_hash: "hash-cam" }),
        ]),
        report([]),
      ]),
      storage: createMemoryStorage(),
      progressIntervalMs: 1,
    });

    await app.waitForIdle();

    setInputValue(
      getByLabelText(root, "Profile name") as HTMLInputElement,
      "Optional profile",
    );
    fireEvent.click(getByLabelText(root, "Optional Webcam (usb)"));

    const requiredToggle = root.querySelector<HTMLInputElement>(
      ".observation-item .checkbox-label input",
    );
    if (!requiredToggle) {
      throw new Error("required toggle was not rendered");
    }
    fireEvent.click(requiredToggle);

    fireEvent.click(getByRole(root, "button", { name: "Save profile" }));
    fireEvent.click(getByRole(root, "button", { name: "Check desk" }));

    await waitFor(() => {
      expect(root.textContent).toContain("Missing (1)");
    });

    expect(root.textContent).toContain("(optional)");
    expect(root.textContent).toContain("Missing 1 (0 required)");
  });

  it("preserves historical snapshots across profile edits and deletion", async () => {
    const root = document.createElement("main");
    document.body.append(root);

    const app = createDockAuditApp(root, {
      backend: backendFromScans([
        report([
          observation("usb", "Desk Keyboard", {
            serial_hash: "hash-kbd",
          }),
        ]),
        report([
          observation("usb", "Desk Keyboard", {
            serial_hash: "hash-kbd",
          }),
        ]),
      ]),
      storage: createMemoryStorage(),
      progressIntervalMs: 1,
    });

    await app.waitForIdle();

    setInputValue(
      getByLabelText(root, "Profile name") as HTMLInputElement,
      "Snapshot profile",
    );
    fireEvent.click(getByLabelText(root, "Desk Keyboard (usb)"));
    setInputValue(
      root.querySelector<HTMLInputElement>("#alias-0")!,
      "Keyboard v1",
    );
    fireEvent.click(getByRole(root, "button", { name: "Save profile" }));

    fireEvent.click(getByRole(root, "button", { name: "Check desk" }));
    await waitFor(() => {
      expect(root.textContent).toContain("Snapshots (1)");
    });

    setInputValue(
      root.querySelector<HTMLInputElement>("#edit-alias-0")!,
      "Keyboard v2",
    );
    fireEvent.click(getByRole(root, "button", { name: "Save profile edits" }));

    expect(root.textContent).toContain("Keyboard v1");

    fireEvent.click(
      getByRole(root, "button", { name: "Delete selected profile" }),
    );

    expect(root.textContent).toContain(
      "Deleted selected profile. Existing snapshots were preserved without rewrite.",
    );
    expect(root.textContent).toContain("Snapshots (1)");
    expect(root.textContent).toContain("Keyboard v1");
  });

  it("passes axe accessibility checks without serious or critical violations", async () => {
    const root = document.createElement("main");
    document.body.append(root);

    const app = createDockAuditApp(root, {
      backend: backendFromScans([
        report([
          observation("usb", "Keyboard", { serial_hash: "hash-kbd" }),
          observation("display", "Monitor", { edid: "hash-display" }),
        ]),
      ]),
      storage: createMemoryStorage(),
      progressIntervalMs: 1,
    });

    await app.waitForIdle();

    const results = await axe.run(root, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });

    const severe = results.violations.filter((violation) => {
      return violation.impact === "serious" || violation.impact === "critical";
    });

    expect(
      severe.map((violation) => `${violation.id}: ${violation.help}`),
    ).toEqual([]);
  });
});
