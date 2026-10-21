"use client";
import Image from "next/image";
import { isNativeApp } from "./runtime";
import { nativeSocialSignIn } from "./native-runtime";
import { nativeLoginErrorMessage } from "./native-contract";
import { useEffect, useState } from "react";
import { MessageCircle, Info, ChevronRight } from "lucide-react";
import Spinner from "./components/Spinner";
import {
  getAuthConfig,
  getSupabaseClient,
  type AuthConfig,
} from "./client-api";
import {
  callbackUrl,
  safeReturnPath,
  embeddedBrowser,
} from "./auth-navigation";
import styles from "./AuthPanel.module.css";
import Dialog from "./components/Dialog";
import AppInfo from "./components/AppInfo";

function rememberReturnPath() {
  const path = safeReturnPath(location.pathname);
  try {
    sessionStorage.setItem("tripboogie:returnTo", path);
  } catch {
    /* OAuth can still return through its validated next parameter. */
  }
  return path;
}
export default function AuthPanel({
  onAuthenticated,
}: {
  onAuthenticated: () => void;
}) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [about,setAbout]=useState(false);
  const [busy, setBusy] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(
      () => setEmbedded(!isNativeApp() && embeddedBrowser(navigator.userAgent)),
      0
    );
    const resume = () => setBusy(false);
    window.addEventListener("pageshow", resume);
    getAuthConfig()
      .then(setConfig)
      .catch(() => setError("로그인 연결을 확인하지 못했어북."));
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pageshow", resume);
    };
  }, []);
  async function social(provider: "google" | "kakao") {
    setBusy(true);
    setError("");
    const returnPath = rememberReturnPath();
    try {
      const client = await getSupabaseClient();
      if (!client) throw new Error("unavailable");
      if (isNativeApp()) {
        await nativeSocialSignIn(client, provider);
        sessionStorage.removeItem("tripboogie:returnTo");
        onAuthenticated();
        setBusy(false);
        return;
      }
      if (provider === "google" && embeddedBrowser(navigator.userAgent)) {
        setError("구글 로그인은 Chrome이나 Safari에서 열어북.");
        setBusy(false);
        return;
      }
      const { data, error } = await client.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: callbackUrl(location.origin, returnPath),
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (!data.url) throw new Error("missing authorization URL");
      const destination = new URL(data.url),
        config = await getAuthConfig();
      if (
        destination.origin !== new URL(config.url).origin ||
        destination.pathname !== "/auth/v1/authorize"
      )
        throw new Error("invalid authorization URL");
      location.assign(destination.href);
    } catch (e) {
      setError(
        isNativeApp()
          ? nativeLoginErrorMessage(provider, e)
          : "로그인을 연결하지 못했어북. 다시 시도해북."
      );
      setBusy(false);
    }
  }
  return (
    <section className={styles.panel}>
        <div className={styles.heading}>
          <Image
            unoptimized
            src="/map-mascot.png"
            width={96}
            height={96}
            alt="거북이 부기"
          />
          <div className={styles.bubble}>
            <h2>반가워북</h2>
            <p>같이 떠날 준비 됐어북?</p>
          </div>
        </div>
      {embedded && (
        <p className={styles.notice}>구글 로그인은 기본 브라우저에서 열어북.</p>
      )}
      <div className={styles.socials}>
        <button
          type="button"
          className={styles.kakao}
          disabled={busy || !config?.providers.kakao}
          onClick={() => social("kakao")}
        >
          <MessageCircle size={19} fill="currentColor" />
          카카오로 시작해북
        </button>
        <button
          type="button"
          disabled={busy || !config?.providers.google}
          onClick={() => social("google")}
        >
          <span className={styles.google}>G</span>구글로 시작해북
        </button>
      </div>
      {busy && (
        <p className={styles.loading} role="status" aria-label="로그인 중">
          <Spinner size={20} />
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={`${styles.info} account-setting-list`}><button type="button" onClick={()=>setAbout(true)}><Info size={19}/><span>앱 정보</span><ChevronRight size={16}/></button></div>
      {about&&<Dialog title="앱 정보" onClose={()=>setAbout(false)}><AppInfo/></Dialog>}
    </section>
  );
}
