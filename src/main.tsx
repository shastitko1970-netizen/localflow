import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import FlowBar from "./FlowBar";
import { ThemeProvider } from "./providers/theme-provider";
import "./styles/globals.css";
import "./styles/flowbar.css";

function isFlowBarHash() {
  return window.location.hash.includes("flowbar");
}

function mount(view: "flowbar" | "main") {
  if (view === "flowbar") document.documentElement.classList.add("flowbar-root");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      {view === "flowbar" ? (
        <FlowBar />
      ) : (
        <ThemeProvider>
          <App />
        </ThemeProvider>
      )}
    </React.StrictMode>,
  );
}

if (isFlowBarHash()) {
  mount("flowbar");
} else {
  import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => {
      mount(getCurrentWindow().label === "flowbar" ? "flowbar" : "main");
    })
    .catch(() => mount("main"));
}
