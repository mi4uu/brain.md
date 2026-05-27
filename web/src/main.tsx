import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { installAuthFetch } from "./auth/token";

// V53: install the fetch wrapper before React mounts so the first /api/*
// call already carries the Bearer header (if a token is in localStorage).
installAuthFetch();

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
