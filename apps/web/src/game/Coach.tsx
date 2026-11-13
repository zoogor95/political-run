/** The tutorial's coach card over the map, and the outline on what the current step points at. */
import { useEffect, useState } from "react";
import { TUTORIAL, finishTutorial, saveStep, savedStep, type CoachContext } from "./tutorial";

export function Coach({ context, onClose }: { context: CoachContext; onClose: () => void }) {
  const [index, setIndex] = useState(savedStep);
  // The card can shrink to a bar so it doesn't hide the map; each new step opens it again.
  const [small, setSmall] = useState(false);
  const step = TUTORIAL[index]!;
  const last = index === TUTORIAL.length - 1;
  const advance = () => {
    const next = Math.min(index + 1, TUTORIAL.length - 1);
    setIndex(next);
    saveStep(next);
    setSmall(false);
  };
  const done = step.done?.(context) ?? false;

  // Steps that wait for the player move on as soon as the match shows it's done.
  useEffect(() => {
    if (done && !last) advance();
  });

  // Point at the step's target. React leaves attributes it didn't set alone, so the outline survives re-renders;
  // it is put back after every render in case the element was replaced.
  useEffect(() => {
    document.querySelectorAll("[data-coach]").forEach((el) => el.removeAttribute("data-coach"));
    if (step.target) document.querySelectorAll(`[data-testid="${step.target}"]`).forEach((el) => el.setAttribute("data-coach", "on"));
  });
  useEffect(() => () => document.querySelectorAll("[data-coach]").forEach((el) => el.removeAttribute("data-coach")), []);

  if (small) {
    return (
      <aside className="coach coach-small" data-testid="coach">
        <button type="button" onClick={() => setSmall(false)} aria-label={`Show the tutorial: ${step.title}`} data-testid="coach-show">
          Learn to play · {step.title}
        </button>
      </aside>
    );
  }

  return (
    <aside className="coach" role="dialog" aria-labelledby="coach-title" data-testid="coach">
      <div className="coach-head">
        <small>
          Learn to play · {index + 1} of {TUTORIAL.length}
        </small>
        <button type="button" className="coach-skip" onClick={() => setSmall(true)} data-testid="coach-hide">
          Hide
        </button>
        <button
          type="button"
          className="coach-skip"
          onClick={() => {
            finishTutorial();
            onClose();
          }}
          data-testid="coach-skip"
        >
          {last ? "Close" : "Skip tutorial"}
        </button>
      </div>
      <h3 id="coach-title">{step.title}</h3>
      <p>{step.text}</p>
      {!step.done && (
        <button
          type="button"
          className="primary"
          onClick={() => {
            if (last) {
              finishTutorial();
              onClose();
            } else advance();
          }}
          data-testid="coach-next"
        >
          {last ? "Finish" : "Next"}
        </button>
      )}
    </aside>
  );
}
