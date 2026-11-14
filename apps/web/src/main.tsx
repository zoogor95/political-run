import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { initAudio } from "./game/audio";
import { startCloud } from "./game/cloud";
import { Game } from "./game/Game";
import { SettingsPanel, SetupScreen } from "./game/Menu";
import { MainMenu } from "./game/MainMenu";
import { AchievementToast, ProfileScreen } from "./game/Profile";
import { loadMatch, clearSave } from "./game/saves";
import { defaultConfig, type Mode } from "./game/setup";
import { isMapId, preferredMap, selectMap } from "./game/model";
import { restartTutorial, tutorialConfig } from "./game/tutorial";
import { useSettings } from "./game/settings";
import type { GameStart } from "./game/useGame";
import { Lab } from "./Lab";
import { LobbyScreen, OngoingScreen, OnlineHub } from "./game/Online";
import { MatchLink, normalizeInvite, openLobby, type RoomView } from "./game/online";
import "./styles.css";
import "./game/game.css";

type Screen =
  | { name: "menu" }
  | { name: "profile" }
  | { name: "online" }
  | { name: "ongoing" }
  | { name: "lobby"; link: MatchLink }
  | { name: "setup"; mode: Mode }
  | { name: "game"; start: GameStart; key: number };

/** A shared invite link (?join=CODE) opens the lobby straight away. */
function joinCode(): string | null {
  const code = new URLSearchParams(location.search).get("join");
  return code ? normalizeInvite(code) : null;
}

/** Links with ?seed=, ?ai=, ?map= or ?scenario= go straight into a solo match (used by tests and shared links); &luck turns on the luck factor. */
function directStart(): GameStart | null {
  const params = new URLSearchParams(location.search);
  if (!params.has("seed") && !params.has("ai") && !params.has("scenario") && !params.has("map")) return null;
  const ai = params.get("ai");
  const level = ai === "easy" || ai === "hard" ? ai : "normal";
  const scenario = params.get("scenario");
  // The scenarios are set up on the UK board.
  selectMap(scenario ? "uk" : (params.get("map") ?? "uk"));
  const config = defaultConfig("solo", level);
  if (params.has("luck")) config.luck = true;
  const start: GameStart = { config };
  const seed = Number(params.get("seed"));
  if (seed) start.seed = seed;
  if (scenario === "hung" || scenario === "tie") start.scenario = scenario;
  return start;
}

function App() {
  useSettings();
  const direct = directStart();
  const [screen, setScreen] = useState<Screen>(() => {
    if (direct) return { name: "game", start: direct, key: 0 };
    const code = joinCode();
    return code ? { name: "lobby", link: new MatchLink(code) } : { name: "menu" };
  });
  const toMenu = () => {
    if (screen.name === "game" && screen.start.online) screen.start.online.link.close();
    // Drop ?join= so a reload goes to the menu, not back into the lobby.
    if (location.search.includes("join=")) history.replaceState(null, "", location.pathname);
    setScreen({ name: "menu" });
  };
  // While in an online match the address carries its code, so a reload rejoins it.
  const code = screen.name === "lobby" ? screen.link.code : screen.name === "game" ? screen.start.online?.link.code : undefined;
  useEffect(() => {
    if (code && !location.search.includes(`join=${code}`)) history.replaceState(null, "", `?join=${code}`);
  }, [code]);
  const play = useCallback((link: MatchLink, view: RoomView) => {
    selectMap(view.setup.map, view.setup.customs ?? []);
    setScreen({ name: "game", start: { online: { link, view } }, key: Date.now() });
  }, []);
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
          onProfile={() => setScreen({ name: "profile" })}
          onOnline={() => setScreen({ name: "online" })}
          onOngoing={() => setScreen({ name: "ongoing" })}
          onTutorial={() => {
            selectMap("uk");
            restartTutorial();
            clearSave();
            setScreen({ name: "game", start: { config: tutorialConfig() }, key: Date.now() });
          }}
          onNew={(mode) => {
            selectMap(preferredMap()); // the map chosen on the menu, with its own leaders
            setScreen({ name: "setup", mode });
          }}
          onSettings={openSettings}
        />
      )}
      {screen.name === "profile" && <ProfileScreen onBack={() => setScreen({ name: "menu" })} />}
      {screen.name === "online" && (
        <OnlineHub
          onBack={toMenu}
          onCreate={() => {
            selectMap(preferredMap());
            setScreen({ name: "setup", mode: "online" });
          }}
          onJoin={(code) => setScreen({ name: "lobby", link: new MatchLink(code) })}
        />
      )}
      {screen.name === "ongoing" && <OngoingScreen onBack={toMenu} onOpen={(code) => setScreen({ name: "lobby", link: new MatchLink(code) })} />}
      {screen.name === "lobby" && <LobbyScreen link={screen.link} onBack={toMenu} onPlay={(view) => play(screen.link, view)} />}
      {screen.name === "setup" && (
        <SetupScreen
          mode={screen.mode}
          onBack={() => setScreen(screen.mode === "online" ? { name: "online" } : { name: "menu" })}
          onStart={(config) => {
            if (config.mode === "online") {
              return openLobby(config).then((code) => setScreen({ name: "lobby", link: new MatchLink(code) }));
            }
            selectMap(config.map ?? "uk", config.customs ?? []);
            clearSave();
            setScreen({ name: "game", start: { config }, key: Date.now() });
          }}
        />
      )}
      {screen.name === "game" && <Game key={screen.key} start={screen.start} onMenu={toMenu} onSettings={openSettings} />}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      <AchievementToast />
    </>
  );
}

initAudio();
const lab = new URLSearchParams(location.search).has("lab");
if (!lab) startCloud();
createRoot(document.getElementById("root")!).render(<StrictMode>{lab ? <Lab /> : <App />}</StrictMode>);
