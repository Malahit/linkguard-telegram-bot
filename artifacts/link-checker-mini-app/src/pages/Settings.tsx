import { useTelegram } from "@/lib/telegram";
import { useGetUserSettings, getGetUserSettingsQueryKey, useUpdateUserSettings } from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { User, Bell, Shield, Info, ExternalLink } from "lucide-react";
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const OPENCLAW_CHANNEL = "https://t.me/openclaw";

export default function SettingsPage() {
  const { telegramUserId } = useTelegram();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetUserSettings(
    { telegramUserId },
    { query: { enabled: !!telegramUserId, queryKey: getGetUserSettingsQueryKey({ telegramUserId }) } }
  );

  const updateSettings = useUpdateUserSettings();
  const [parentContact, setParentContact] = useState("");
  const [notify, setNotify] = useState(false);

  useEffect(() => {
    if (settings) {
      setParentContact(settings.parentContact || "");
      setNotify(settings.notifyParentOnDanger);
    }
  }, [settings]);

  const handleUpdateParentContact = () => {
    if (parentContact !== settings?.parentContact) {
      updateSettings.mutate(
        { data: { telegramUserId, parentContact: parentContact.trim() || null } },
        { onSuccess: (data) => queryClient.setQueryData(getGetUserSettingsQueryKey({ telegramUserId }), data) }
      );
    }
  };

  const handleToggleNotify = (checked: boolean) => {
    setNotify(checked);
    updateSettings.mutate(
      { data: { telegramUserId, notifyParentOnDanger: checked } },
      { onSuccess: (data) => queryClient.setQueryData(getGetUserSettingsQueryKey({ telegramUserId }), data) }
    );
  };

  if (isLoading) {
    return (
      <div className="px-5 py-6 space-y-4">
        {[1, 2, 3].map(i => <div key={i} className="h-24 bg-card rounded-2xl animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="px-5 py-6 space-y-8 pb-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Настройки</h1>
        <p className="text-sm text-muted-foreground mt-1">Только ты управляешь своими данными</p>
      </div>

      <div className="space-y-6">
        {/* Parent contact */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-primary px-1">
            <User size={16} />
            <h2 className="font-semibold text-sm">Контакт взрослого</h2>
          </div>
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <label className="text-sm font-medium block">Telegram-аккаунт взрослого</label>
            <input
              type="text"
              value={parentContact}
              onChange={(e) => setParentContact(e.target.value)}
              onBlur={handleUpdateParentContact}
              placeholder="@username"
              className="w-full h-12 px-3 bg-muted rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="text-xs text-muted-foreground flex gap-1.5 items-start">
              <Info size={13} className="shrink-0 mt-0.5" />
              <span>Отправляется только по кнопке «Показать взрослому» или при авто-уведомлении. Без твоего действия — ничего не отправляется.</span>
            </p>
          </div>
        </section>

        {/* Notifications */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-primary px-1">
            <Bell size={16} />
            <h2 className="font-semibold text-sm">Уведомления</h2>
          </div>
          <div className="bg-card border border-border rounded-2xl p-4 flex items-center justify-between">
            <div className="flex-1 pr-4">
              <p className="font-medium text-sm">Авто-уведомление взрослому</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Если ссылка опасна — сразу отправить взрослому без твоего тапа
              </p>
            </div>
            <Switch checked={notify} onCheckedChange={handleToggleNotify} />
          </div>
        </section>

        {/* Trusted domains */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-primary px-1">
            <Shield size={16} />
            <h2 className="font-semibold text-sm">Доверенные сайты</h2>
          </div>
          <div className="bg-card border border-border rounded-2xl p-4">
            {settings?.trustedDomains && settings.trustedDomains.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {settings.trustedDomains.map(domain => (
                  <span key={domain} className="px-3 py-1 bg-muted text-xs font-medium rounded-lg">
                    {domain}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground leading-relaxed">
                Пока нет. Сайты из твоего списка всегда будут получать вердикт «Безопасно» без проверки.
              </p>
            )}
          </div>
        </section>

        {/* OpenClaw block */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-primary px-1">
            <span className="text-sm font-bold">OC</span>
            <h2 className="font-semibold text-sm">OpenClaw</h2>
          </div>
          <a
            href={OPENCLAW_CHANNEL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 bg-card border border-border rounded-2xl p-4 active:opacity-70 transition-opacity"
          >
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shrink-0">
              <span className="text-primary-foreground font-black text-xs">OC</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Наш Telegram-канал</p>
              <p className="text-xs text-muted-foreground">Цифровая гигиена — просто и понятно</p>
            </div>
            <ExternalLink size={16} className="text-muted-foreground shrink-0" />
          </a>
          <p className="text-[11px] text-muted-foreground text-center px-2">
            OpenClaw не собирает твои данные сверх необходимого. История хранится только у тебя.
          </p>
        </section>
      </div>
    </div>
  );
}
