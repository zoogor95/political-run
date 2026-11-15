/**
 * Sign in or create an account with a username and password. Usernames are unique (any capitals count the same). Creating
 * an account on a device that already backs up its profile adds the login to that profile, so nothing is lost.
 */
import { useEffect, useState } from "react";
import { changePassword, CloudError, signIn, signUp, useCloud, usernameAvailable } from "./cloud";

type Mode = "signin" | "register";

/** What's wrong with a username as typed, or null when it's fine. */
export function usernameProblem(name: string): string | null {
  if (name.length < 3) return "At least 3 characters.";
  if (name.length > 20) return "At most 20 characters.";
  if (!/^[A-Za-z0-9_]+$/.test(name)) return "Letters, numbers and underscores only.";
  return null;
}

export function LoginScreen({ onBack }: { onBack: () => void }) {
  const cloud = useCloud();
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [free, setFree] = useState<null | boolean>(null);
  const signedInAs = cloud.state !== "off" ? cloud.username : null;

  // While registering, ask whether the name is free once it's a valid name and the typing pauses.
  const typed = username.trim();
  useEffect(() => {
    setFree(null);
    if (mode !== "register" || usernameProblem(typed)) return;
    let live = true;
    const t = setTimeout(() => void usernameAvailable(typed).then((r) => live && setFree(r ? r.available : null)), 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [typed, mode]);

  const registerProblem = mode === "register" ? (usernameProblem(typed) ?? (password.length < 8 ? "Passwords need at least 8 characters." : password !== again ? "The two passwords don't match." : free === false ? "That username is taken." : null)) : null;
  const ready = mode === "signin" ? typed.length > 0 && password.length > 0 : registerProblem === null;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (mode === "signin") await signIn(typed, password);
      else await signUp(typed, password);
      onBack();
    } catch (e) {
      setError(e instanceof CloudError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="setup online login" data-testid="login">
      <header className="setup-head">
        <button type="button" onClick={onBack} data-testid="login-back">
          Back
        </button>
        <h1>{signedInAs ? "Your account" : "Sign in"}</h1>
      </header>
      {signedInAs ? (
        <>
          <section className="backup" data-testid="login-done">
            <p>
              You're signed in as <b>{signedInAs}</b>.
            </p>
            <p className="small">Sign in with this username and password on any device to get your profile back.</p>
          </section>
          <ChangePassword />
        </>
      ) : (
        <form
          className="backup login-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !busy) void submit();
          }}
        >
          <div className="kind quick-mode" role="radiogroup" aria-label="Sign in or create an account">
            <button type="button" role="radio" aria-checked={mode === "signin"} onClick={() => (setMode("signin"), setError(""))} data-testid="login-tab-signin">
              Sign in
            </button>
            <button type="button" role="radio" aria-checked={mode === "register"} onClick={() => (setMode("register"), setError(""))} data-testid="login-tab-register">
              Create account
            </button>
          </div>
          <label className="creator-field">
            <span>Username</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={20} autoComplete="username" autoCapitalize="none" spellCheck={false} data-testid="login-username" />
          </label>
          {mode === "register" && typed.length > 0 && (
            <small className={usernameProblem(typed) || free === false ? "bad" : "muted"} data-testid="login-username-note" aria-live="polite">
              {usernameProblem(typed) ?? (free === false ? "That username is taken." : free === true ? "That username is free." : "Checking…")}
            </small>
          )}
          <label className="creator-field">
            <span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} autoComplete={mode === "signin" ? "current-password" : "new-password"} data-testid="login-password" />
          </label>
          {mode === "register" && (
            <label className="creator-field">
              <span>Password again</span>
              <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} maxLength={128} autoComplete="new-password" data-testid="login-password-again" />
            </label>
          )}
          {mode === "register" && <small className="muted">3 to 20 letters, numbers or underscores. At least 8 characters for the password. Anything you've earned on this device goes with the account.</small>}
          {error && (
            <p className="backup-error" role="alert" data-testid="login-error">
              {error}
            </p>
          )}
          <div className="backup-actions">
            <button type="submit" className="primary" disabled={!ready || busy} data-testid="login-go">
              {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}

/** Change the password: needs the current one, and signs every other device out. */
function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const problem = next.length < 8 ? "The new password needs at least 8 characters." : next !== again ? "The two new passwords don't match." : null;
  const submit = async () => {
    setBusy(true);
    setError("");
    setDone(false);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setAgain("");
      setDone(true);
    } catch (e) {
      setError(e instanceof CloudError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="backup login-form"
      data-testid="change-password"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem && current && !busy) void submit();
      }}
    >
      <h2>Change password</h2>
      <label className="creator-field">
        <span>Current password</span>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" maxLength={128} data-testid="pw-current" />
      </label>
      <label className="creator-field">
        <span>New password</span>
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" maxLength={128} data-testid="pw-new" />
      </label>
      <label className="creator-field">
        <span>New password again</span>
        <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" maxLength={128} data-testid="pw-again" />
      </label>
      <small className="muted">Changing it signs you out on every other device.</small>
      {error && (
        <p className="backup-error" role="alert" data-testid="pw-error">
          {error}
        </p>
      )}
      {done && (
        <p role="status" data-testid="pw-done">
          Password changed. Other devices were signed out.
        </p>
      )}
      <div className="backup-actions">
        <button type="submit" className="primary" disabled={!current || problem !== null || busy} data-testid="pw-go">
          {busy ? "One moment…" : "Change password"}
        </button>
      </div>
    </form>
  );
}
