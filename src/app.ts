const bootstrapMessage =
  "Inventory adapters are not implemented yet. No devices were scanned.";

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

export function renderApp(root: HTMLElement): void {
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
  noticeCopy.append(
    textElement("strong", "Inventory unavailable"),
    textElement("p", bootstrapMessage),
  );
  notice.append(icon, noticeCopy);
  card.append(notice);

  card.append(
    textElement(
      "p",
      "This bootstrap build does not inspect hardware, collect identifiers, or send data.",
      "privacy-note",
    ),
  );

  root.append(card);
}
