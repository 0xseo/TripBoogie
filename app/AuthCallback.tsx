"use client";
import { useEffect, useState, type FormEvent } from "react";
import { getSupabaseClient } from "./client-api";
export default function AuthCallback() {
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    getSupabaseClient()
      .then(async (client) => {
        if (!client) throw new Error("로그인 연결이 아직 준비되지 않았어요.");
        const params = new URLSearchParams(location.search);
        if (params.has("error"))
          throw new Error("로그인을 완료하지 못했어요. 로그인 화면에서 다시 시도해 주세요.");
        const { data, error } = await client.auth.getSession();
        if (error || !data.session)
          throw new Error("확인 링크가 만료되었거나 같은 브라우저에서 시작한 요청이 아니에요.");
        if (!active) return;
        if (params.get("recovery") === "1") {
          setRecovery(true);
          return;
        }
        const saved = sessionStorage.getItem("tripboogie:returnTo");
        sessionStorage.removeItem("tripboogie:returnTo");
        const next = saved && /^\/invite\/[A-Za-z0-9_-]+$/.test(saved) ? saved : "/";
        location.replace(next);
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, []);
  async function change(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    try {
      const client = await getSupabaseClient();
      if (!client) throw new Error();
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      location.replace("/");
    } catch {
      setError("비밀번호를 변경하지 못했어요. 새 재설정 링크를 요청해 주세요.");
      setBusy(false);
    }
  }
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeContent: "center",
        padding: 24,
        background: "#f5f7f1",
        color: "#184b3a",
        textAlign: "center",
      }}
    >
      <img
        src="/turtle-mascot.png"
        width="140"
        height="135"
        alt="트립부기 거북이"
        style={{ margin: "0 auto 20px" }}
      />
      <h1 style={{ fontSize: 25 }}>
        {recovery ? "새 비밀번호를 정해 주세요" : "여행을 준비하고 있어요"}
      </h1>
      {recovery && (
        <form onSubmit={change} style={{ display: "grid", gap: 14, marginTop: 20 }}>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            aria-label="새 비밀번호"
            required
            minLength={8}
            maxLength={256}
            placeholder="새 비밀번호 8자 이상"
            style={{ padding: 14, border: "1px solid #cbd8ca", borderRadius: 10 }}
          />
          <button
            disabled={busy}
            style={{
              padding: 14,
              border: 0,
              borderRadius: 10,
              background: "#166044",
              color: "white",
            }}
          >
            비밀번호 변경
          </button>
        </form>
      )}
      {error ? (
        <>
          <p role="alert" style={{ maxWidth: 380, lineHeight: 1.8 }}>
            {error}
          </p>
          <a href="/">로그인 화면으로 돌아가기</a>
        </>
      ) : (
        !recovery && <p>로그인 정보를 확인하는 중입니다.</p>
      )}
    </main>
  );
}
