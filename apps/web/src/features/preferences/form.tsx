"use client";

import type { ProfileSettings } from "@lotse/brain/language";
import { useRouter } from "next/navigation";
import { type ReactElement, useState } from "react";
import { useI18n } from "@/i18n/provider.tsx";

export function PreferencesForm({ settings }: { settings: ProfileSettings }): ReactElement {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<"saved" | "error" | null>(null);

  async function save(data: FormData): Promise<void> {
    setPending(true);
    setStatus(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: data.get("language"),
          simpleLanguage: data.get("simpleLanguage") === "on",
          register: data.get("register"),
          detailLevel: data.get("detailLevel"),
        }),
      });
      if (!response.ok) throw new Error("PROFILE_SETTINGS_FAILED");
      setStatus("saved");
      router.refresh();
    } catch {
      setStatus("error");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save(new FormData(event.currentTarget));
      }}
    >
      <p>{t("preferences.help")}</p>
      <fieldset disabled={pending} aria-busy={pending}>
        <label>
          {t("preferences.language")}
          <select name="language" defaultValue={settings.language}>
            <option value="de">{t("preferences.german")}</option>
            <option value="en">{t("preferences.english")}</option>
          </select>
        </label>
        <label>
          <input type="checkbox" name="simpleLanguage" defaultChecked={settings.simpleLanguage} />
          {t("preferences.simpleLanguage")}
        </label>
        <label>
          {t("preferences.register")}
          <select name="register" defaultValue={settings.register}>
            <option value="formal">{t("preferences.formal")}</option>
            <option value="informal">{t("preferences.informal")}</option>
          </select>
        </label>
        <label>
          {t("preferences.detailLevel")}
          <select name="detailLevel" defaultValue={settings.detailLevel}>
            <option value="brief">{t("preferences.brief")}</option>
            <option value="standard">{t("preferences.standard")}</option>
            <option value="detailed">{t("preferences.detailed")}</option>
          </select>
        </label>
        <button type="submit">{t(pending ? "preferences.saving" : "preferences.save")}</button>
      </fieldset>
      <p aria-live="polite" aria-atomic="true">
        {status ? t(`preferences.${status}`) : ""}
      </p>
    </form>
  );
}
