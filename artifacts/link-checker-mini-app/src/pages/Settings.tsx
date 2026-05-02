import { useTelegram } from "@/lib/telegram";
import { useGetUserSettings, getGetUserSettingsQueryKey, useUpdateUserSettings } from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { User, Bell, Shield, Info } from "lucide-react";
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

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

  const handleUpdateParentContact = (e: React.FocusEvent<HTMLInputElement>) => {
    if (parentContact !== settings?.parentContact) {
      updateSettings.mutate({
        data: { telegramUserId, parentContact: parentContact.trim() || null }
      }, {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetUserSettingsQueryKey({ telegramUserId }), data);
        }
      });
    }
  };

  const handleToggleNotify = (checked: boolean) => {
    setNotify(checked);
    updateSettings.mutate({
      data: { telegramUserId, notifyParentOnDanger: checked }
    }, {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetUserSettingsQueryKey({ telegramUserId }), data);
      }
    });
  };

  if (isLoading) return <div className="p-6">Загрузка...</div>;

  return (
    <div className="px-5 py-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Настройки</h1>
      </div>

      <div className="space-y-6">
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-primary px-1">
            <User size={18} />
            <h2 className="font-semibold">Контакт взрослому</h2>
          </div>
          <div className="bg-card border border-border rounded-2xl p-4">
            <label className="text-sm font-medium block mb-2">Telegram Username взрослого</label>
            <input 
              type="text"
              value={parentContact}
              onChange={(e) => setParentContact(e.target.value)}
              onBlur={handleUpdateParentContact}
              placeholder="@username"
              className="w-full h-12 px-3 bg-muted rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="text-xs text-muted-foreground mt-3 flex gap-1">
              <Info size={14} className="shrink-0" />
              <span>Этот контакт будет использоваться для быстрой отправки подозрительных ссылок.</span>
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-primary px-1">
            <Bell size={18} />
            <h2 className="font-semibold">Уведомления</h2>
          </div>
          <div className="bg-card border border-border rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Авто-уведомление</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">
                Автоматически отправлять взрослому, если ссылка опасна
              </p>
            </div>
            <Switch checked={notify} onCheckedChange={handleToggleNotify} />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-primary px-1">
            <Shield size={18} />
            <h2 className="font-semibold">Доверенные сайты</h2>
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
              <p className="text-sm text-muted-foreground">Пока нет доверенных сайтов. Они будут добавляться автоматически при частом использовании.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
