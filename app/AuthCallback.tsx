"use client";
import Form from "./components/Form";
import KeyboardFocus from "./components/KeyboardFocus";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { callbackFailure, safeReturnPath } from "./auth-navigation";
import { getSupabaseClient, exchangeCallbackCode } from "./client-api";
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
        const fragment = new URLSearchParams(location.hash.slice(1));
        for (const key of ["error", "error_code"])
          if (!params.has(key) && fragment.has(key))
            params.set(key, fragment.get(key)!);
        const failure = callbackFailure(params);
        if (failure) throw new Error(failure);
        const code = params.get("code");
        if (code) {
          if (!/^[A-Za-z0-9._~-]{1,2048}$/.test(code))
            throw new Error(
              "로그인 링크가 올바르지 않아요. 다시 시작해 주세요."
            );
          const result = await exchangeCallbackCode(client, code);
          if (result.error)
            throw new Error(
              "로그인 확인에 실패했어요. 로그인을 시작한 Chrome·Safari 또는 설치된 앱에서 다시 시도해 주세요."
            );
        }
        const { data, error } = await client.auth.getSession();
        if (error || !data.session || !code)
          throw new Error(
            "로그인 링크가 만료됐거나 다른 브라우저에서 열린 링크예요. 원래 브라우저에서 다시 로그인해 주세요."
          );
        const verified = await client.auth.getUser();
        if (verified.error || !verified.data.user)
          throw new Error(
            "로그인 상태를 확인하지 못했어요. 인터넷 연결을 확인하고 다시 시작해 주세요."
          );
        if (!active) return;
        if (params.get("recovery") === "1") {
          history.replaceState(null, "", "/auth/callback?recovery=1");
          setRecovery(true);
          return;
        }
        let saved = "";
        try {
          saved = sessionStorage.getItem("tripboogie:returnTo") || "";
          sessionStorage.removeItem("tripboogie:returnTo");
        } catch {}
        const next = safeReturnPath(params.get("next") || saved);
        history.replaceState(null, "", "/auth/callback");
        location.replace(next);
      })
      .catch((e) => {
        history.replaceState(null, "", "/auth/callback");
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function change(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const password = String(
      new FormData(e.currentTarget).get("password") ?? ""
    );
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
        minHeight: "var(--visual-viewport-height, 100dvh)",
        display: "grid",
        placeContent: "center",
        padding: 24,
        background: "#f5f7f1",
        color: "#184b3a",
        textAlign: "center",
      }}
    >
      <KeyboardFocus/>
      <Image
        src="/map-mascot.png"
        width={140}
        height={135}
        alt="트립부기 거북이"
        style={{ margin: "0 auto 20px" }}
      />
      <h1 style={{ fontSize: 25 }}>
        {recovery ? "새 비밀번호를 정해북" : "여행을 준비하고 있어북"}
      </h1>
      {recovery && (
        <Form
          onSubmit={change}
          style={{ display: "grid", gap: 14, marginTop: 20 }}
        >
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            aria-label="새 비밀번호"
            required
            minLength={8}
            maxLength={256}
            placeholder="새 비밀번호 8자 이상"
            style={{
              padding: 14,
              border: "1px solid #cbd8ca",
              borderRadius: 10,
            }}
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
        </Form>
      )}
      {error ? (
        <>
          <p role="alert" style={{ maxWidth: 380, lineHeight: 1.8 }}>
            {error}
          </p>
          <Link href="/">로그인 화면으로 돌아가기</Link>
        </>
      ) : (
        !recovery && <p>로그인 정보를 확인하는 중이야북</p>
      )}
    </main>
  );
}
