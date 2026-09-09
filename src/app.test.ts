import {
  fireEvent,
  getByLabelText,
  getByRole,
  waitFor,
} from "@testing-library/dom";
import * as axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  type BackupArchive,
  type DeviceClass,
  type DockAuditBackend,
  type InventoryReport,
  type Observation,
  compareProfileFallback,
  createBackupArchive,
  createDockAuditApp,
  createMemoryStorage,
  createSupportReport,
  parseBackupArchive,
  previewRestoreConflicts,
  redactForExport,
  stableStringify,
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

function sampleState(
  overrides: Partial<Parameters<typeof createBackupArchive>[0]> = {},
): Parameters<typeof createBackupArchive>[0] {
  const profile = {
    id: "profile-1",
    name: "Desk profile",
    expectations: [
      {
        id: "expectation-1",
        class: "usb" as const,
        alias: "Keyboard",
        required: true,
        expected_fields: {
          serial: "SERIAL-ABCD-1234",
          mount_path: "/home/tester/dev/input0",
        },
        identity_hashes: {
          serial_hash: "a1b2c3d4e5f6g7h8i9j0",
        },
        friendly_name: "Desk Keyboard",
      },
    ],
    version: 1,
    updated_at: "2026-09-07T00:00:00.000Z",
  };

  const scan = report([
    observation("usb", "Desk Keyboard", {
      serial_hash: "a1b2c3d4e5f6g7h8i9j0",
    }),
  ]);
  const comparison = compareProfileFallback(profile, scan);
  const snapshot = {
    id: "snapshot-1",
    profile_id: profile.id,
    profile_version: profile.version,
    profile_view: {
      name: profile.name,
      expectations: [
        { alias: "Keyboard", class: "usb" as const, required: true },
      ],
    },
    captured_at: "2026-09-07T00:00:00.000Z",
    report: scan,
    comparison,
  };

  return {
    selected_profile_id: profile.id,
    profiles: [profile],
    snapshots: [snapshot],
    timeline_events: [
      {
        id: "timeline-1",
        captured_at: "2026-09-07T00:00:00.000Z",
        category: "operator" as const,
        message: "seed event",
        details: {
          machine_name: "workstation-01",
          mac: "aa:bb:cc:dd:ee:ff",
        },
      },
    ],
    settings: {
      snapshot_limit: 30,
      timeline_limit: 200,
      timeline_days: 14,
      timeline_capture_enabled: false,
      include_identifying_exports: false,
    },
    ...overrides,
  };
}

describe("Dock Audit issue #6 private timeline + export workflow", () => {
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

  it("deletes linked snapshots when deleting a profile", async () => {
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
      expect(root.textContent).toContain("Snapshots and retention (1)");
    });

    fireEvent.click(
      getByRole(root, "button", { name: "Delete selected profile" }),
    );

    expect(root.textContent).toContain(
      "Deleted selected profile and removed linked snapshots from local history.",
    );
    expect(root.textContent).toContain("Snapshots and retention (0)");
  });

  it("records scan timeline events and class deltas when timeline capture is enabled", async () => {
    const root = document.createElement("main");
    document.body.append(root);

    const app = createDockAuditApp(root, {
      backend: backendFromScans([
        report([observation("usb", "Keyboard")]),
        report([
          observation("usb", "Keyboard"),
          observation("display", "Monitor"),
        ]),
      ]),
      storage: createMemoryStorage(),
      progressIntervalMs: 1,
    });

    await app.waitForIdle();

    fireEvent.click(
      getByRole(root, "button", { name: "Enable timeline capture" }),
    );
    fireEvent.click(getByRole(root, "button", { name: "Re-scan inventory" }));

    await waitFor(() => {
      expect(root.textContent).toContain("Inventory scan completed.");
    });

    expect(root.textContent).toContain("count changed by +1");
    expect(root.textContent).toContain("Private app-session timeline");
  });

  it("prunes snapshots based on retention settings", async () => {
    const root = document.createElement("main");
    document.body.append(root);

    const keyboard = observation("usb", "Desk Keyboard", {
      serial_hash: "hash-kbd",
    });

    const app = createDockAuditApp(root, {
      backend: backendFromScans([
        report([keyboard]),
        report([keyboard]),
        report([keyboard]),
      ]),
      storage: createMemoryStorage(),
      progressIntervalMs: 1,
    });

    await app.waitForIdle();

    setInputValue(
      getByLabelText(root, "Profile name") as HTMLInputElement,
      "Retention profile",
    );
    fireEvent.click(getByLabelText(root, "Desk Keyboard (usb)"));
    fireEvent.click(getByRole(root, "button", { name: "Save profile" }));

    fireEvent.click(getByRole(root, "button", { name: "Check desk" }));
    await waitFor(() => {
      expect(root.textContent).toContain("Snapshots and retention (1)");
    });

    fireEvent.click(getByRole(root, "button", { name: "Check desk" }));
    await waitFor(() => {
      expect(root.textContent).toContain("Snapshots and retention (2)");
    });

    setInputValue(
      getByLabelText(root, "Snapshot retention limit") as HTMLInputElement,
      "1",
    );
    fireEvent.click(
      getByRole(root, "button", { name: "Save retention settings" }),
    );

    expect(root.textContent).toContain("Snapshots and retention (1)");
  });

  it("creates redacted support reports by default with optional identifying opt-in", () => {
    const state = sampleState();
    const runtime = {
      scanHealth: {
        usb: "complete" as const,
        display: "complete" as const,
        audio_input: "complete" as const,
        audio_output: "complete" as const,
        network: "complete" as const,
      },
      capabilityGaps: [],
      notice: "ready",
    };
    const redacted = createSupportReport(state, runtime, false);

    expect(redacted.json).toContain("[REDACTED]");
    expect(redacted.json).not.toContain("SERIAL-ABCD-1234");
    expect(redacted.json).not.toContain("/home/tester/dev/input0");
    expect(redacted.json).not.toContain("aa:bb:cc:dd:ee:ff");

    const full = createSupportReport(state, runtime, true);

    expect(full.json).toContain("SERIAL-ABCD-1234");
    expect(full.json).toContain("/home/tester/dev/input0");
    expect(full.json).toContain("aa:bb:cc:dd:ee:ff");
  });

  it("supports versioned backup roundtrip and conflict previews", () => {
    const state = sampleState();
    const backup = createBackupArchive(state);
    const roundtrip = parseBackupArchive(JSON.stringify(backup));

    expect(stableStringify(roundtrip)).toEqual(stableStringify(backup));

    const baseProfile = state.profiles[0];
    expect(baseProfile).toBeDefined();
    const incoming = createBackupArchive(
      sampleState({
        profiles: [
          baseProfile!,
          {
            ...baseProfile!,
            id: "profile-2",
            name: "Added profile",
          },
        ],
      }),
    );

    const preview = previewRestoreConflicts(state, incoming);
    expect(preview.profiles_overwritten).toBe(1);
    expect(preview.profiles_added).toBe(1);
    expect(preview.snapshots_overwritten).toBe(1);
    expect(preview.timeline_events_replaced).toBe(state.timeline_events.length);
  });

  it("rejects malformed backup payloads", () => {
    expect(() => parseBackupArchive("{not json")).toThrow(
      "Backup JSON is malformed.",
    );

    // Deterministic mutation corpus (fixed-seed LCG) derived from a valid
    // archive: every mutated payload must either parse to a valid archive or
    // throw a plain-text error, and never return a partially restored state.
    const valid = JSON.stringify(createBackupArchive(sampleState()));
    const validVersion = createBackupArchive(sampleState()).version;
    const charset = '"{}[]0az<>:,';
    let seed = 0x2545f491;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const outcomes: {
      ok: boolean;
      parsed?: BackupArchive;
      message?: string;
    }[] = [];
    for (let index = 0; index < 240; index += 1) {
      const bytes = valid.split("");
      const position = Math.floor(random() * bytes.length);
      const injected = charset[Math.floor(random() * charset.length)] ?? ",";
      const mode = index % 4;
      if (mode === 0) {
        bytes.splice(position);
      } else if (mode === 1) {
        bytes.splice(position, 0, injected);
      } else if (mode === 2) {
        bytes[position] = injected;
      } else {
        bytes.splice(position, 1);
      }
      const mutated = bytes.join("");
      try {
        outcomes.push({ ok: true, parsed: parseBackupArchive(mutated) });
      } catch (error) {
        outcomes.push({ ok: false, message: (error as Error).message });
      }
    }
    const accepted = outcomes.filter((outcome) => outcome.ok);
    const rejected = outcomes.filter((outcome) => !outcome.ok);
    expect(outcomes.length).toBe(240);
    expect(rejected.length).toBeGreaterThan(0);
    for (const outcome of accepted) {
      expect(outcome.parsed?.version).toBe(validVersion);
      expect(Array.isArray(outcome.parsed?.profiles)).toBe(true);
    }
    for (const outcome of rejected) {
      expect(outcome.message?.length).toBeGreaterThan(0);
      expect(outcome.message).not.toMatch(/[{}]/);
    }

    expect(() =>
      parseBackupArchive(
        JSON.stringify({
          version: 1,
          selected_profile_id: null,
          profiles: [],
          snapshots: [],
          timeline_events: [],
          settings: {
            snapshot_limit: 30,
            timeline_limit: 200,
            timeline_days: 14,
            timeline_capture_enabled: false,
            include_identifying_exports: false,
          },
        }),
      ),
    ).toThrow("Unsupported backup version");
  });

  it("keeps restore atomic when malformed input is applied", async () => {
    const root = document.createElement("main");
    document.body.append(root);

    const seeded = sampleState();
    const storage = createMemoryStorage(seeded);
    const app = createDockAuditApp(root, {
      backend: backendFromScans([report([observation("usb", "Keyboard")])]),
      storage,
      progressIntervalMs: 1,
    });

    await app.waitForIdle();
    expect(root.textContent).toContain("Selected profile");
    expect(root.textContent).toContain("Snapshots and retention (1)");

    setInputValue(
      getByLabelText(root, "Paste backup JSON") as HTMLInputElement,
      "{ definitely-not-json",
    );
    fireEvent.click(
      getByRole(root, "button", { name: "Apply restore (atomic)" }),
    );

    expect(root.textContent).toContain("Backup JSON is malformed.");
    expect(root.textContent).toContain("Selected profile");
    expect(root.textContent).toContain("Snapshots and retention (1)");
  });

  it("treats script-like device labels as text and not executable markup", async () => {
    const root = document.createElement("main");
    document.body.append(root);

    const riskyLabel = "<script>alert('xss')</script> Dock";
    const app = createDockAuditApp(root, {
      backend: backendFromScans([report([observation("usb", riskyLabel)])]),
      storage: createMemoryStorage(),
      progressIntervalMs: 1,
    });

    await app.waitForIdle();

    expect(root.textContent).toContain(`${riskyLabel} (usb)`);
    expect(root.innerHTML).not.toContain("<script>alert('xss')</script>");
  });

  it("redaction is idempotent for structured payloads", () => {
    const payload = {
      nested: {
        serial: "SERIAL-123",
        owner: "alice",
        path: "/home/alice/dev/input0",
      },
      values: ["aa:bb:cc:dd:ee:ff", "normal-text"],
    };

    const once = redactForExport(payload, false);
    const twice = redactForExport(once, false);

    expect(stableStringify(twice)).toEqual(stableStringify(once));
  });

  it("erase-all clears profiles snapshots and timeline", async () => {
    const root = document.createElement("main");
    document.body.append(root);

    const app = createDockAuditApp(root, {
      backend: backendFromScans([
        report([observation("usb", "Desk Keyboard")]),
        report([observation("usb", "Desk Keyboard")]),
      ]),
      storage: createMemoryStorage(),
      progressIntervalMs: 1,
    });

    await app.waitForIdle();

    setInputValue(
      getByLabelText(root, "Profile name") as HTMLInputElement,
      "Cleanup profile",
    );
    fireEvent.click(getByLabelText(root, "Desk Keyboard (usb)"));
    fireEvent.click(getByRole(root, "button", { name: "Save profile" }));
    fireEvent.click(
      getByRole(root, "button", { name: "Enable timeline capture" }),
    );
    fireEvent.click(getByRole(root, "button", { name: "Check desk" }));
    await waitFor(() => {
      expect(root.textContent).toContain("Snapshots and retention (1)");
    });

    fireEvent.click(
      getByRole(root, "button", { name: "Erase all local data" }),
    );

    expect(root.textContent).toContain("No saved profiles yet.");
    expect(root.textContent).toContain("Snapshots and retention (0)");
    expect(root.textContent).toContain("Recording disabled.");
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
