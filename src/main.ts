import "./styles.css";
import { renderApp } from "./app";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Dock Audit root element is missing");
}

renderApp(root);
