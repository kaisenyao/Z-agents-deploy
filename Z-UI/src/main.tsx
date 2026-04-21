import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// Chat markdown styling (paragraph spacing, lists, etc.) lives here.
// Without importing it, Tailwind preflight removes default <p> margins,
// making markdown paragraphs appear to run together.
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(<App />);
  