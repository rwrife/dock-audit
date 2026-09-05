import { getByRole } from "@testing-library/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapStatus, renderApp } from "./app";

describe("Dock Audit bootstrap shell", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("announces unavailable native inventory without fabricating devices", () => {
    const root = document.createElement("main");
    document.body.append(root);

    renderApp(root);

    expect(getByRole(root, "heading", { name: "Dock Audit" })).toBeTruthy();
    expect(getByRole(root, "status").textContent).toContain(
      "No native inventory adapter is available",
    );
    expect(root.querySelectorAll("[data-device-observation]")).toHaveLength(0);
  });

  it("renders capability gaps and an opt-in count-only diagnostic", () => {
    const root = document.createElement("main");
    const onDiagnostic = vi.fn();
    document.body.append(root);

    renderApp(
      root,
      {
        ...bootstrapStatus,
        availability: "degraded",
        capability_gaps: [
          {
            class: "display",
            capability: "displayconfig.target_name",
            kind: "access_denied",
            message:
              "The native API denied this read-only query; the affected class is unknown.",
            error_code: 5,
          },
        ],
      },
      {
        diagnostic: {
          capability_counts: {
            "display.gap.displayconfig.target_name.access_denied": 1,
          },
        },
        onDiagnostic,
      },
    );

    getByRole(root, "button", {
      name: "Run redacted native diagnostic",
    }).click();

    expect(onDiagnostic).toHaveBeenCalledOnce();
    expect(
      getByRole(root, "heading", { name: "Capability gaps" }),
    ).toBeTruthy();
    expect(
      getByRole(root, "heading", { name: "Redacted native diagnostic" }),
    ).toBeTruthy();
    expect(root.textContent).not.toContain("device_instance");
  });
});
