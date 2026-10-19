import { createRoot } from "react-dom/client";
import TripApp from "../app/TripApp";
import AuthCallback from "../app/AuthCallback";
import type { Bootstrap } from "../app/types";
import { apiFetch, getSupabaseClient } from "../app/client-api";
import { startNativeApp, observeNativeSession } from "../app/native-runtime";
import "../app/styles.css";
import "./native.css";
async function main() {
  await startNativeApp();
  await observeNativeSession(await getSupabaseClient());
  const callback = location.pathname === "/auth/callback";
  // Keep the launch screen visible until the server has verified the restored session.
  const bootstrap = callback ? undefined : await apiFetch<Bootstrap>("/api/bootstrap");
  createRoot(document.getElementById("root")!).render(callback ? <AuthCallback /> : <TripApp initialBootstrap={bootstrap}/>);
}
void main().catch(() => {
  const root = document.getElementById("root")!;
  const message = document.createElement("p");
  message.textContent = "앱을 준비하지 못했어요. 앱을 종료한 뒤 다시 열어 주세요.";
  const retry = document.createElement("button");
  retry.textContent = "다시 시도";
  retry.onclick = () => location.reload();
  root.replaceChildren(message);
  root.appendChild(retry);
});
