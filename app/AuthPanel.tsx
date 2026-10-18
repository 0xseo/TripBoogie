"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Mail, MessageCircle, LockKeyhole, LoaderCircle } from "lucide-react";
import { getAuthConfig, getSupabaseClient, type AuthConfig } from "./client-api";
import styles from "./AuthPanel.module.css";

function friendlyError(message: string) {
  if (/invalid login/i.test(message)) return "이메일 또는 비밀번호를 확인해 주세요.";
  if (/email not confirmed/i.test(message)) return "받은 메일의 확인 링크를 먼저 눌러 주세요.";
  if (/rate limit|too many|security purposes/i.test(message)) return "잠시 후 다시 시도해 주세요.";
  if (/already registered|already been registered/i.test(message))
    return "이미 가입한 이메일이에요. 로그인해 주세요.";
  if (/password/i.test(message)) return "비밀번호 조건을 확인해 주세요.";
  return "로그인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.";
}
function rememberReturnPath() {
  if (location.pathname.startsWith("/invite/"))
    sessionStorage.setItem("tripboogie:returnTo", location.pathname);
}
export default function AuthPanel({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    getAuthConfig()
      .then(setConfig)
      .catch(() => setError("로그인 연결을 확인하지 못했어요."));
  }, []);
  async function social(provider: "google" | "kakao") {
    setBusy(true);
    setError("");
    rememberReturnPath();
    try {
      const client = await getSupabaseClient();
      if (!client) throw new Error("unavailable");
      const { error } = await client.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${location.origin}/auth/callback` },
      });
      if (error) throw error;
    } catch {
      setError("이 로그인 연결이 아직 준비되지 않았어요.");
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    rememberReturnPath();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    try {
      const client = await getSupabaseClient();
      if (!client) throw new Error("unavailable");
      if (mode === "reset") {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${location.origin}/auth/callback?recovery=1`,
        });
        if (error) throw error;
        setMessage("계정이 있다면 비밀번호 재설정 안내를 보냈어요. 받은 메일을 확인해 주세요.");
      } else if (mode === "signup") {
        const name = String(data.get("name") ?? "").trim();
        const { data: auth, error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name },
            emailRedirectTo: `${location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        if (auth.session) onAuthenticated();
        else setMessage("이메일 확인을 요청했어요. 받은 메일의 링크로 가입을 마무리해 주세요.");
      } else {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuthenticated();
      }
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : ""));
    } finally {
      setBusy(false);
    }
  }
  const available = !!config?.url && !!config.publishableKey;
  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <img src="/turtle-mascot.png" width="88" height="84" alt="손을 흔드는 트립부기 거북이" />
        <div>
          <span>TRIPBOOGIE</span>
          <h2>
            {mode === "signup"
              ? "함께 갈 준비 됐나요?"
              : mode === "reset"
                ? "비밀번호 다시 설정"
                : "반가워요, 여행 친구!"}
          </h2>
          <p>우리끼리 계획하고, 느긋하게 떠나요.</p>
        </div>
      </div>
      {mode !== "reset" && (
        <>
          <div className={styles.socials}>
            <button
              type="button"
              disabled={busy || !config?.providers.google}
              onClick={() => social("google")}
            >
              <span className={styles.google}>G</span>Google로 계속하기
              {config && !config.providers.google && <small>연결 준비 중</small>}
            </button>
            <button
              className={styles.kakao}
              type="button"
              disabled={busy || !config?.providers.kakao}
              onClick={() => social("kakao")}
            >
              <MessageCircle size={18} fill="currentColor" />
              카카오로 계속하기{config && !config.providers.kakao && <small>연결 준비 중</small>}
            </button>
          </div>
          <div className={styles.divider}>
            <span>또는 이메일로</span>
          </div>
        </>
      )}
      {!available && config && (
        <p className={styles.notice}>
          로그인 연결을 준비하고 있어요. 지금은 샘플 여행을 먼저 둘러볼 수 있어요.
        </p>
      )}
      <form onSubmit={submit} className={styles.form}>
        {mode === "signup" && (
          <label>
            이름
            <input
              name="name"
              autoComplete="nickname"
              placeholder="친구들이 부를 이름"
              required
              maxLength={80}
            />
          </label>
        )}
        <label>
          이메일
          <div className={styles.input}>
            <Mail size={17} />
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="hello@example.com"
              required
              maxLength={254}
            />
          </div>
        </label>
        {mode !== "reset" && (
          <label>
            비밀번호
            <div className={styles.input}>
              <LockKeyhole size={17} />
              <input
                name="password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                placeholder={
                  mode === "signup" ? "8자 이상으로 설정해 주세요" : "비밀번호를 입력해 주세요"
                }
                minLength={mode === "signup" ? 8 : 1}
                maxLength={256}
                required
              />
            </div>
          </label>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className={styles.success} role="status">
            {message}
          </p>
        )}
        <button
          className={styles.primary}
          disabled={busy || !available || !config?.providers.email}
        >
          {busy ? (
            <LoaderCircle size={18} className={styles.spin} />
          ) : (
            <>
              {mode === "signup" ? "계정 만들기" : mode === "reset" ? "재설정 메일 받기" : "로그인"}
              <ArrowRight size={17} />
            </>
          )}
        </button>
      </form>
      <div className={styles.footer}>
        <button
          onClick={() => {
            setMode(mode === "signup" ? "login" : "signup");
            setError("");
            setMessage("");
          }}
        >
          {mode === "signup" ? "이미 계정이 있나요? 로그인" : "처음 오셨나요? 이메일로 가입하기"}
        </button>
        {mode === "login" && (
          <button
            onClick={() => {
              setMode("reset");
              setError("");
              setMessage("");
            }}
          >
            비밀번호를 잊으셨나요?
          </button>
        )}
        {mode === "reset" && <button onClick={() => setMode("login")}>로그인으로 돌아가기</button>}
      </div>
      <p className={styles.privacy}>여행은 초대한 친구에게만 공유됩니다.</p>
    </section>
  );
}
