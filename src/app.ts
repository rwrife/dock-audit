export interface AdapterStatus {
  availability: "available" | "degraded" | "unavailable";
  observation_count: number;
  message: string;
  scan_health: Record<
    string,
    "complete" | "partial" | "failed" | "unsupported"
  >;
  capability_gaps: Array<{
    class: string;
    capability: string;
    kind:
      "access_denied" | "api_unavailable" | "query_failed" | "privacy_limited";
    message: string;
    error_code: number | null;
  }>;
}

export interface RedactedDiagnostic {
  capability_counts: Record<string, number>;
}

export const bootstrapStatus: AdapterStatus = {
  availability: "unavailable",
  observation_count: 0,
  message:
    "No native inventory adapter is available on this platform. No devices were scanned.",
  scan_health: {
    usb: "unsupported",
    display: "unsupported",
    audio_input: "unsupported",
    audio_output: "unsupported",
    network: "unsupported",
  },
  capability_gaps: [],
};

interface RenderOptions {
  diagnostic?: RedactedDiagnostic;
  diagnosticError?: string;
  onDiagnostic?: () => void;
}

function textElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  text: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.textContent = text;
  if (className) {
    element.className = className;
  }
  return element;
}

export function renderApp(
  root: HTMLElement,
  status: AdapterStatus = bootstrapStatus,
  options: RenderOptions = {},
): void {
  root.className = "app-shell";
  root.replaceChildren();

  const card = document.createElement("section");
  card.className = "status-card";
  card.setAttribute("aria-labelledby", "app-title");

  card.append(textElement("p", "Local-first desk checks", "eyebrow"));

  const title = textElement("h1", "Dock Audit");
  title.id = "app-title";
  card.append(title);

  card.append(
    textElement(
      "p",
      "Compare only the peripherals you approve, without an account or telemetry.",
      "lede",
    ),
  );

  const notice = document.createElement("div");
  notice.className = "notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");

  const icon = textElement("span", "!", "notice__icon");
  icon.setAttribute("aria-hidden", "true");

  const noticeCopy = document.createElement("div");
  noticeCopy.append(textElement("strong", `Inventory ${status.availability}`));
  noticeCopy.append(textElement("p", status.message));
  notice.append(icon, noticeCopy);
  card.append(notice);

  const health = document.createElement("ul");
  health.className = "scan-health";
  health.setAttribute("aria-label", "Inventory scan health");
  for (const [deviceClass, scanHealth] of Object.entries(status.scan_health)) {
    health.append(
      textElement("li", `${deviceClass.replaceAll("_", " ")}: ${scanHealth}`),
    );
  }
  card.append(health);

  if (status.capability_gaps.length > 0) {
    const gaps = document.createElement("section");
    gaps.className = "capability-gaps";
    gaps.append(textElement("h2", "Capability gaps"));
    const list = document.createElement("ul");
    for (const gap of status.capability_gaps) {
      list.append(
        textElement(
          "li",
          `${gap.class.replaceAll("_", " ")} / ${gap.capability}: ${gap.message}`,
        ),
      );
    }
    gaps.append(list);
    card.append(gaps);
  }

  if (options.onDiagnostic) {
    const diagnosticButton = textElement(
      "button",
      "Run redacted native diagnostic",
      "diagnostic-button",
    );
    diagnosticButton.type = "button";
    diagnosticButton.addEventListener("click", options.onDiagnostic);
    card.append(diagnosticButton);
  }

  if (options.diagnostic) {
    const diagnostic = document.createElement("section");
    diagnostic.className = "diagnostic";
    diagnostic.append(textElement("h2", "Redacted native diagnostic"));
    diagnostic.append(
      textElement(
        "p",
        "This opt-in diagnostic contains capability counts only; it does not include device names or identifiers.",
      ),
    );
    const counts = document.createElement("ul");
    for (const [capability, count] of Object.entries(
      options.diagnostic.capability_counts,
    )) {
      counts.append(textElement("li", `${capability}: ${count}`));
    }
    diagnostic.append(counts);
    card.append(diagnostic);
  } else if (options.diagnosticError) {
    const diagnosticError = textElement(
      "p",
      options.diagnosticError,
      "diagnostic-error",
    );
    diagnosticError.setAttribute("role", "status");
    card.append(diagnosticError);
  }

  card.append(
    textElement(
      "p",
      "Inventory uses ordinary-user, read-only native APIs. It never opens media streams, captures traffic, changes hardware or settings, or sends telemetry.",
      "privacy-note",
    ),
  );

  root.append(card);
}
