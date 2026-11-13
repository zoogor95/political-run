import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { initAudio } from "./game/audio";
import { Game } from "./game/Game";
import { MainMenu, SettingsPanel, SetupScreen } from "./game/Menu";
import { loadMatch, clearSave } from "./game/saves";
import { defaultConfig, type Mode } from "./game/setup";
import { isMapId, map, selectMap } from "./game/model";
import { restartTutorial, tutorialConfig } from "./game/tutorial";
import { useSettings } from "./game/settings";
import type { GameStart } from "./game/useGame";
import { Lab } from "./Lab";
import "./styles.css";
import "./game/game.css";

type Screen = { name: "menu" } | { name: "setup"; mode: Mode } | { name: "game"; start: GameStart; key: number };

/** Links with ?seed=, ?ai=, ?map= or ?scenario= go straight into a solo match (used by tests and shared links). */
function directStart(): GameStart | null {
  const params = new URLSearchParams(location.search);
  if (!params.has("seed") && !params.has("ai") && !params.has("scenario") && !params.has("map")) return null;
  const ai = params.get("ai");
  const level = ai === "easy" || ai === "hard" ? ai : "normal";
  const scenario = params.get("scenario");
  // The scenarios are set up on the UK board.
  selectMap(scenario ? "uk" : (params.get("map") ?? "uk"));
  const start: GameStart = { config: defaultConfig("solo", level) };
  const seed = Number(params.get("seed"));
  if (seed) start.seed = seed;
  if (scenario === "hung" || scenario === "tie") start.scenario = scenario;
  return start;
}

function App() {
  useSettings();
  const direct = directStart();
  const [screen, setScreen] = useState<Screen>(() => (direct ? { name: "game", start: direct, key: 0 } : { name: "menu" }));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = () => setSettingsOpen(true);
  return (
    <>
      {screen.name === "menu" && (
        <MainMenu
          onContinue={() => {
            const save = loadMatch();
            if (!save) return;
            selectMap(isMapId(save.state.packId) ? save.state.packId : "uk", save.config.customs ?? []);
            setScreen({ name: "game", start: { save }, key: Date.now() });
          }}
          onTutorial={() => {
            selectMap("uk");
            restartTutorial();
            clearSave();
            setScreen({ name: "game", start: { config: tutorialConfig() }, key: Date.now() });
          }}
          onNew={(mode) => {
            selectMap(map.id); // the setup screen starts from the map's own leaders
            setScreen({ name: "setup", mode });
          }}
          onSettings={openSettings}
        />
      )}
      {screen.name === "setup" && (
        <SetupScreen
          mode={screen.mode}
          onBack={() => setScreen({ name: "menu" })}
          onStart={(config) => {
            selectMap(config.map ?? "uk", config.customs ?? []);
            clearSave();
            setScreen({ name: "game", start: { config }, key: Date.now() });
          }}
        />
      )}
      {screen.name === "game" && <Game key={screen.key} start={screen.start} onMenu={() => setScreen({ name: "menu" })} onSettings={openSettings} />}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

initAudio();
const lab = new URLSearchParams(location.search).has("lab");
createRoot(document.getElementById("root")!).render(<StrictMode>{lab ? <Lab /> : <App />}</StrictMode>);
