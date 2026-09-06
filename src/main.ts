import { invoke } from "@tauri-apps/api/core";
import "./styles.css";
import {
  type ComparisonResult,
  createDockAuditApp,
  type DockAuditBackend,
  type InventoryReport,
  type Profile,
} from "./app";

function requiredAppRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>("#app");
  if (root === null) {
    throw new Error("Dock Audit root element is missing");
  }
  return root;
}

const backend: DockAuditBackend = {
  async scanInventory(): Promise<InventoryReport> {
    return invoke<InventoryReport>("inventory_report");
  },
  async compareProfile(
    profile: Profile,
    report: InventoryReport,
  ): Promise<ComparisonResult> {
    return invoke<ComparisonResult>("compare_profile", { profile, report });
  },
};

createDockAuditApp(requiredAppRoot(), { backend });
