import type { BranchRecord, DeviceRecord, Lang, StaffRecord } from "@lalcha/domain";
import { useCallback, useEffect, useState } from "react";
import type { StringKey } from "./i18n";
import { apiFetch, type CurrentUser } from "./session";

type T = (k: StringKey) => string;
const fieldClass = "mt-1 h-12 w-full border-[3px] border-line bg-bg px-3 text-lg font-bold";
const FORM_ERRORS: StringKey[] = ["invalid_pin", "weak_pin", "email_required", "invalid_email", "duplicate_email", "invalid_phone", "duplicate_phone", "forbidden", "name_required"];

export function StaffScreen({ user, lang, t, online }: { user: CurrentUser; lang: Lang; t: T; online: boolean }) {
  const [staff, setStaff] = useState<StaffRecord[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [currentDevice, setCurrentDevice] = useState("");
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [editing, setEditing] = useState<{ member: StaffRecord | null } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const isOwner = user.role === "owner";

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/v1/staff");
      if (!res.ok) throw new Error();
      setStaff(((await res.json()) as { staff: StaffRecord[] }).staff);
      if (isOwner) {
        const d = await apiFetch("/v1/devices");
        if (!d.ok) throw new Error();
        const body = (await d.json()) as { devices: DeviceRecord[]; currentId: string };
        setDevices(body.devices);
        setCurrentDevice(body.currentId);
        const b = await apiFetch("/v1/branches");
        if (b.ok) setBranches(((await b.json()) as { branches: BranchRecord[] }).branches);
      }
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [isOwner]);

  useEffect(() => {
    if (online) void load();
  }, [online, load]);

  const canEdit = (m: StaffRecord) => (isOwner ? m.role !== "owner" || m.id === user.id : m.role === "cashier");

  async function revoke(id: string) {
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    setConfirming(null);
    await apiFetch(`/v1/devices/${id}`, { method: "DELETE" }).catch(() => setFailed(true));
    await load();
  }

  return (
    <main className="no-print min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mx-auto max-w-3xl space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-black">{t("staff")}</h1>
          <button disabled={!online} onClick={() => setEditing({ member: null })} className="min-h-13 bg-accent px-4 text-lg font-black text-on-accent ring-[3px] ring-line ring-inset disabled:opacity-40">
            + {t("addStaff")}
          </button>
        </div>
        {!online && <p role="alert" className="font-bold text-hot">{t("needOnline")}</p>}
        {failed && <p role="alert" className="font-bold text-hot">{t("saveFailed")}</p>}

        <ul className="space-y-2">
          {staff.map((m) => (
            <li key={m.id}>
              <button
                disabled={!canEdit(m) || !online}
                onClick={() => setEditing({ member: m })}
                className={`flex min-h-16 w-full items-center justify-between gap-3 border-[3px] border-line bg-panel p-3 text-left ${m.disabled ? "opacity-50" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-lg font-black">{m.name}</span>
                  <span className="block font-bold text-muted">{m.email ?? m.phone ?? "—"}</span>
                </span>
                <span className="shrink-0 bg-text px-2 py-1 font-black text-bg">{m.disabled ? t("disabled") : t(m.role)}</span>
              </button>
            </li>
          ))}
        </ul>

        {isOwner && (
          <section className="pt-3">
            <h2 className="mb-2 text-2xl font-black">{t("devices")}</h2>
            <ul className="space-y-2">
              {devices.map((d) => (
                <li key={d.id} className="flex min-h-16 items-center justify-between gap-3 border-[3px] border-line bg-panel p-3">
                  <span className="min-w-0">
                    <span className="block truncate text-lg font-black">{d.name}</span>
                    <span className="block text-sm font-bold text-muted">
                      {d.id === currentDevice ? t("thisDevice") : new Date(d.lastSeenAt).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB")}
                    </span>
                  </span>
                  {branches.length > 1 && (
                    <select
                      aria-label={`${t("branches")}: ${d.name}`}
                      disabled={!online}
                      value={d.branchId}
                      onChange={(e) => void apiFetch(`/v1/devices/${d.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ branchId: e.target.value }) }).then(load)}
                      className="h-11 shrink-0 border-2 border-line bg-bg px-2 font-bold"
                    >
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  )}
                  {d.id !== currentDevice && (
                    <button disabled={!online} className="min-h-11 shrink-0 font-bold text-hot underline" onClick={() => void revoke(d.id)}>
                      {confirming === d.id ? t("archiveConfirm") : t("removeDevice")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {editing && (
        <StaffForm
          key={editing.member?.id ?? "new"}
          member={editing.member}
          user={user}
          t={t}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </main>
  );
}

function StaffForm({ member, user, t, onClose, onSaved }: { member: StaffRecord | null; user: CurrentUser; t: T; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(member?.name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [phone, setPhone] = useState(member?.phone ?? "");
  const [role, setRole] = useState(member?.role === "manager" ? "manager" : "cashier");
  const [pin, setPin] = useState("");
  const [disabled, setDisabled] = useState(member?.disabled ?? false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isOwnerRecord = member?.role === "owner";

  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    const fields = { name, email: email.trim().toLowerCase() || null, phone: phone || null, role: isOwnerRecord ? "manager" : role };
    try {
      const res = member
        ? await apiFetch(`/v1/staff/${member.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...fields, pin: pin || null, disabled }),
          })
        : await apiFetch("/v1/staff", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...fields, pin }),
          });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        const code = body?.error as StringKey | undefined;
        setError(code && FORM_ERRORS.includes(code) ? t(code) : t("saveFailed"));
        return;
      }
      await onSaved();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={member ? t("editStaff") : t("addStaff")}>
      <form
        className="max-h-full w-full max-w-md space-y-3 overflow-y-auto border-[3px] border-line bg-panel p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 className="text-2xl font-black">{member ? t("editStaff") : t("addStaff")}</h2>
        <label className="block font-bold">
          {t("staffName")}
          <input autoFocus required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
        </label>
        <label className="block font-bold">
          {t("email")}
          <input type="email" inputMode="email" autoComplete="off" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className={fieldClass} />
          <span className="block text-sm text-muted">{t("emailHelp")}</span>
        </label>
        <label className="block font-bold">
          {t("phone")}
          <input inputMode="tel" maxLength={11} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} placeholder="01XXXXXXXXX" className={fieldClass} />
        </label>
        {!isOwnerRecord && user.role === "owner" && (
          <label className="block font-bold">
            {t("role")}
            <select value={role} onChange={(e) => setRole(e.target.value)} className={fieldClass}>
              <option value="cashier">{t("cashier")}</option>
              <option value="manager">{t("manager")}</option>
            </select>
          </label>
        )}
        <label className="block font-bold">
          {member ? t("newPin") : t("pin")}
          <input
            type="password"
            autoComplete="new-password"
            required={!member}
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className={fieldClass}
          />
        </label>
        {member && !isOwnerRecord && member.id !== user.id && (
          <label className="flex min-h-11 items-center gap-3 font-bold">
            <input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} className="h-6 w-6" />
            {t("disableStaff")}
          </label>
        )}
        {error && <p role="alert" className="font-bold text-hot">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className="min-h-14 flex-1 border-[3px] border-line text-lg font-black" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" disabled={busy} className="min-h-14 flex-[2] bg-[#12130f] text-xl font-black text-accent ring-2 ring-line disabled:opacity-40">
            {busy ? t("saving") : t("save")}
          </button>
        </div>
      </form>
    </div>
  );
}
