import { invoke } from "@tauri-apps/api/core";
import "./styles.css";
import {
  type AdapterStatus,
  type RedactedDiagnostic,
  bootstrapStatus,
  renderApp,
} from "./app";

function requiredAppRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>("#app");
  if (root === null) {
    throw new Error("Dock Audit root element is missing");
  }
  return root;
}

const appRoot = requiredAppRoot();
let status = bootstrapStatus;
let diagnostic: RedactedDiagnostic | undefined;
let diagnosticError: string | undefined;

function render(): void {
  renderApp(appRoot, status, {
    diagnostic,
    diagnosticError,
    onDiagnostic: () => {
      diagnostic = undefined;
      diagnosticError = undefined;
      void invoke<RedactedDiagnostic>("native_inventory_diagnostic", {
        approved: true,
      }).then(
        (result) => {
          diagnostic = result;
          render();
        },
        () => {
          diagnosticError =
            "The approved native diagnostic did not complete. No device details were emitted.";
          render();
        },
      );
    },
  });
}

render();
void invoke<AdapterStatus>("adapter_status").then(
  (result) => {
    status = result;
    render();
  },
  () => {
    status = {
      ...bootstrapStatus,
      message:
        "The native inventory status could not be loaded. No devices were scanned or treated as missing.",
    };
    render();
  },
);
