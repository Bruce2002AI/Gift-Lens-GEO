"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2, Mail } from "lucide-react";

interface LoginFormProps {
  googleEnabled: boolean;
  callbackUrl: string;
}

type Step = "email" | "code";

export function LoginForm({ googleEnabled, callbackUrl }: LoginFormProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not send the code.");
        return;
      }
      setStep("code");
      setInfo(
        data.devCode
          ? `Dev mode: your code is ${data.devCode} (also printed in the server console).`
          : "We sent a code to your email. Enter it below.",
      );
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signIn("email-otp", {
        email,
        code,
        redirect: false,
      });
      if (result?.error) {
        setError("That code is invalid or expired. Request a new one.");
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("Something went wrong verifying the code.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-6 sm:p-8">
      <div className="mb-6 text-center">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-plum text-white">
          <Mail size={20} aria-hidden />
        </span>
        <h1 className="font-(family-name:--font-display) text-2xl font-semibold text-ink">
          Sign in to ShopLens
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {step === "email"
            ? "Enter your email and we'll send you a one-time code."
            : `Enter the code we sent to ${email}.`}
        </p>
      </div>

      {googleEnabled && step === "email" && (
        <>
          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl })}
            className="btn-secondary w-full"
          >
            <GoogleIcon />
            Continue with Google
          </button>
          <div className="my-5 flex items-center gap-3 text-xs text-ink-soft">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      {step === "email" ? (
        <form onSubmit={requestCode} className="space-y-4">
          <div>
            <label htmlFor="email" className="field-label">
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="field-input"
            />
          </div>
          <button type="submit" disabled={loading || !email} className="btn-primary w-full">
            {loading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            Send code
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="space-y-4">
          <div>
            <label htmlFor="code" className="field-label">
              Verification code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="field-input text-center text-lg tracking-[0.4em]"
            />
          </div>
          <button type="submit" disabled={loading || !code} className="btn-primary w-full">
            {loading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            Verify &amp; sign in
          </button>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
                setInfo(null);
              }}
              className="text-ink-soft hover:text-plum"
            >
              ← Change email
            </button>
            <button
              type="button"
              onClick={() => requestCode()}
              disabled={loading}
              className="text-plum hover:text-plum-dark disabled:opacity-50"
            >
              Resend code
            </button>
          </div>
        </form>
      )}

      {info && (
        <p className="mt-4 rounded-lg bg-plum-wash px-3 py-2 text-sm text-plum">{info}</p>
      )}
      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
