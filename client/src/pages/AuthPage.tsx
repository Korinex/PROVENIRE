import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { isOAuthConfigured, startLogin } from "@/const";

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
  const [message, setMessage] = useState("");
  const isRegister = mode === "register";
  const configured = isOAuthConfigured();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!configured) {
      setMessage("Account access is not configured for this deployment yet. Set VITE_OAUTH_PORTAL_URL and VITE_APP_ID, then restart the app.");
      return;
    }
    if (!startLogin(isRegister ? "signUp" : "signIn")) {
      setMessage("Account access is not configured for this deployment yet.");
    }
  };

  return <main className="auth-page">
    <section className="auth-card" aria-labelledby="auth-title">
      <Link href="/" className="auth-brand">PROVENIRE</Link>
      <h1 id="auth-title">{isRegister ? "Create your account" : "Welcome back"}</h1>
      <p>{isRegister ? "Register securely through the Provenire account provider." : "Sign in securely to continue to your Provenire workspace."}</p>
      <form onSubmit={submit}>
        <button className="auth-provider-button" type="submit">
          {isRegister ? "Continue to registration" : "Continue to sign in"}
        </button>
      </form>
      {!configured && <div className="auth-config-message" role="status">Account access is not configured for this deployment. Add the OAuth portal URL and app ID to the client environment to enable sign-in and registration.</div>}
      {message && <div className="auth-config-message" role="alert">{message}</div>}
      <p className="auth-switch">{isRegister ? "Already registered?" : "New to Provenire?"} {isRegister ? <Link href="/login">Sign in</Link> : <Link href="/register">Create an account</Link>}</p>
      <p className="auth-switch"><Link href="/">Return to the workspace</Link></p>
    </section>
  </main>;
}
