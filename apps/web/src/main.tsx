import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Game } from "./game/Game";
import { Lab } from "./Lab";
import "./styles.css";
import "./game/game.css";

const lab = new URLSearchParams(location.search).has("lab");

createRoot(document.getElementById("root")!).render(<StrictMode>{lab ? <Lab /> : <Game />}</StrictMode>);
