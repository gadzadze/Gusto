"use client";

import { Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { inviteColleagueAction, removeTeamMemberAction, revokeTeamInviteAction } from "@/app/team/actions";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export type MemberView = { userId: string; name: string | null; email: string | null; role: "owner" | "member"; you: boolean; joined: string };
export type InviteView = { id: string; email: string; role: "owner" | "member"; created: string };

const KNOWN = ["invalid_email", "not_owner", "not_active", "already_member", "already_invited", "blocked", "too_many", "last_owner", "rate_limited"];

export function TeamManager({
  canManage,
  members,
  invites,
  otherCompanies,
}: {
  canManage: boolean;
  members: MemberView[];
  invites: InviteView[];
  /** Other companies of the same kind this person owns: a colleague can be added to several at once. */
  otherCompanies: { id: string; name: string }[];
}) {
  const t = useTranslations("team");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "owner">("member");
  const [also, setAlso] = useState<string[]>([]);
  const [note, setNote] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const err = (code: string) => t(`errors.${(KNOWN.includes(code) ? code : "unknown") as "unknown"}`);

  function invite(event: React.FormEvent) {
    event.preventDefault();
    setNote(null);
    startTransition(async () => {
      const result = await inviteColleagueAction({ email, role, alsoOrgIds: also });
      if (result.ok) {
        setNote({ tone: "success", text: t(`invited.${result.emailed}`) });
        setEmail("");
        setAlso([]);
      } else setNote({ tone: "error", text: err(result.error) });
    });
  }

  function remove(member: MemberView) {
    if (!window.confirm(t(member.you ? "leaveConfirm" : "removeConfirm"))) return;
    setNote(null);
    startTransition(async () => {
      const result = await removeTeamMemberAction(member.userId);
      if (result.ok && result.left) router.replace("/start");
      else if (!result.ok) setNote({ tone: "error", text: err(result.error) });
    });
  }

  function revoke(inviteId: string) {
    setNote(null);
    startTransition(async () => {
      const result = await revokeTeamInviteAction(inviteId);
      if (!result.ok) setNote({ tone: "error", text: err(result.error) });
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      {note ? <FormAlert tone={note.tone}>{note.text}</FormAlert> : null}

      <section aria-labelledby="team-members" className="space-y-2">
        <h2 id="team-members" className="font-semibold">{t("members")} ({members.length})</h2>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {m.name || m.email || "-"}
                  {m.you ? <span className="ml-2 text-xs font-normal text-muted-foreground">{t("you")}</span> : null}
                </span>
                <span className="block break-words text-sm text-muted-foreground">
                  {m.email && m.name ? `${m.email} · ` : ""}
                  {t(`role.${m.role}`)} · {m.joined}
                </span>
              </span>
              {canManage || m.you ? (
                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => remove(m)} aria-label={t(m.you ? "leave" : "remove")}>
                  <Trash2 />
                  {t(m.you ? "leave" : "remove")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {canManage && invites.length > 0 ? (
        <section aria-labelledby="team-invites" className="space-y-2">
          <h2 id="team-invites" className="font-semibold">{t("pending")} ({invites.length})</h2>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{i.email}</span>
                  <span className="block text-sm text-muted-foreground">{t(`role.${i.role}`)} · {i.created}</span>
                </span>
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => revoke(i.id)}>
                  {t("revoke")}
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">{t("pendingHint")}</p>
        </section>
      ) : null}

      {canManage ? (
        <section aria-labelledby="team-add" className="space-y-3 rounded-xl border border-border p-4">
          <h2 id="team-add" className="font-semibold">{t("add")}</h2>
          <p className="text-sm text-muted-foreground">{t("addHint")}</p>
          <form onSubmit={invite} className="space-y-4">
            <Field id="team-email" label={t("email")}>
              <Input id="team-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field id="team-role" label={t("roleLabel")} hint={t("roleHint")}>
              <Select id="team-role" value={role} onChange={(e) => setRole(e.target.value as "member" | "owner")}>
                <option value="member">{t("role.member")}</option>
                <option value="owner">{t("role.owner")}</option>
              </Select>
            </Field>
            {otherCompanies.length > 0 ? (
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">{t("alsoIn")}</legend>
                {otherCompanies.map((c) => (
                  <label key={c.id} className="flex min-h-11 items-center gap-2 text-sm md:min-h-8">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={also.includes(c.id)}
                      onChange={(e) => setAlso((cur) => (e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)))}
                    />
                    {c.name}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <Button type="submit" disabled={pending || email.trim() === ""}>
              <UserPlus />
              {t("send")}
            </Button>
          </form>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">{t("ownersOnly")}</p>
      )}
    </div>
  );
}
