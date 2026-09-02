import { getByRole } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";
import { renderApp } from "./app";

describe("Dock Audit bootstrap shell", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("announces that inventory adapters are unavailable without fabricating devices", () => {
    const root = document.createElement("main");
    document.body.append(root);

    renderApp(root);

    expect(getByRole(root, "heading", { name: "Dock Audit" })).toBeTruthy();
    expect(getByRole(root, "status").textContent).toContain(
      "Inventory adapters are not implemented yet",
    );
    expect(root.querySelectorAll("[data-device-observation]")).toHaveLength(0);
  });
});
