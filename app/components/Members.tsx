"use client";
import {useEffect,useState} from "react";
import {Trash2,Link2,Copy} from "lucide-react";
import type {Workspace,Invite} from "../types";
import {apiFetch as api,jsonRequest} from "../client-api";
import {dateLabel} from "./ui";
import ChoiceField from "./ChoiceField";
import {useConfirm} from "./Confirmation";

export default function Members({
  workspace,
  busy,
  onChange,
  onError,
}: {
  workspace: Workspace;
  busy: boolean;
  onChange: (w: Workspace) => void;
  onError: (e: string) => void;
}) {
  const confirm=useConfirm();
  const [invites, setInvites] = useState<Invite[]>([]),
    [url, setUrl] = useState(""),
    [role, setRole] = useState("editor"),
    [pending, setPending] = useState(false),
    owner = workspace.trip.role === "owner";
  useEffect(() => {
    if (!owner) return;
    let active = true;
    api<{ invites: Invite[] }>(`/api/trips/${workspace.trip.id}/invites`)
      .then((r) => {
        if (active) setInvites(r.invites);
      })
      .catch((e) => {
        if (active) onError(e.message);
      });
    return () => {
      active = false;
    };
  }, [owner, workspace.trip.id, onError]);
  async function act(fn: () => Promise<void>) {
    setPending(true);
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="feature">
      <div className="member-list">
        {workspace.members.map((m) => (
          <article key={m.id}>
            <span className="avatar large-avatar">{m.name.slice(0, 1)}</span>
            <div className="record-body">
              <h3>{m.name}</h3>
              <small>{m.email}</small>
            </div>
            <span className="pill">
              {m.role === "owner"
                ? "여행장"
                : m.role === "editor"
                ? "편집자"
                : "열람자"}
            </span>
            {owner && m.role !== "owner" && (
              <button
                className="icon"
                aria-label={`${m.name} 참여 해제`}
                disabled={busy || pending}
                onClick={async () => {
                  if (await confirm(`${m.name}님의 여행 참여를 해제할까요?`))
                    void act(async () =>
                      onChange(
                        await api<Workspace>(
                          `/api/trips/${workspace.trip.id}/members/${m.id}`,
                          { method: "DELETE" }
                        )
                      )
                    );
                }}
              >
                <Trash2 size={18} />
              </button>
            )}
          </article>
        ))}
      </div>
      {owner && (
        <div className="invite-box">
          <h3>동행 초대</h3>

          <div className="inline">
            <ChoiceField label="초대 권한" value={role} disabled={busy||pending} onChange={setRole} options={[{id:"editor",label:"함께 편집"},{id:"viewer",label:"열람·체크리스트"}]}/>
            <button
              className="primary"
              disabled={busy || pending}
              onClick={() =>
                void act(async () => {
                  const result = await api<{
                    url: string;
                    id: string;
                    expiresAt: string;
                  }>(
                    `/api/trips/${workspace.trip.id}/invites`,
                    jsonRequest({ role })
                  );
                  setUrl(result.url);
                  const r = await api<{ invites: Invite[] }>(
                    `/api/trips/${workspace.trip.id}/invites`
                  );
                  setInvites(r.invites);
                })
              }
            >
              <Link2 size={18} />
              초대 링크 만들기
            </button>
          </div>
          {url && (
            <div className="copy-link">
              <input aria-label="생성한 초대 링크" readOnly value={url} />
              <button
                onClick={() =>
                  void navigator.clipboard
                    .writeText(url)
                    .catch(() => onError("링크를 직접 복사해 주세요."))
                }
              >
                <Copy size={18} />
                복사
              </button>
            </div>
          )}
          <div className="invite-list">
            {invites
              .filter((i) => !i.revokedAt)
              .map((i) => (
                <div key={i.id}>
                  <span>
                    {i.role === "editor" ? "편집" : "열람"} 초대 ·{" "}
                    {dateLabel(i.expiresAt.slice(0, 10))} 만료
                  </span>
                  <button
                    className="text-button"
                    disabled={pending}
                    onClick={() =>
                      void act(async () => {
                        await api(
                          `/api/trips/${workspace.trip.id}/invites`,
                          jsonRequest({ id: i.id }, { method: "DELETE" })
                        );
                        setInvites((rows) => rows.filter((x) => x.id !== i.id));
                      })
                    }
                  >
                    초대 취소
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}
