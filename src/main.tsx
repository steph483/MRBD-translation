import { createRoot } from "react-dom/client";
import { RootApp } from "./App";
import "./styles.css";

const mountElement = document.getElementById("root");
if (mountElement == null) {
  throw new Error("Missing application mount element");
}

const windowBackground = "var(--uit-color-background-window)";
document.documentElement.style.background = windowBackground;
document.body.style.background = windowBackground;
mountElement.style.background = windowBackground;

createRoot(mountElement).render(<RootApp />);
