import { useEffect, useState, createContext, useContext, ReactNode } from "react";
import { useRegisterUser } from "@workspace/api-client-react";

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TelegramContextValue {
  user: TelegramUser | null;
  telegramUserId: string;
  theme: "light" | "dark";
  isReady: boolean;
}

const TelegramContext = createContext<TelegramContextValue | null>(null);

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [isReady, setIsReady] = useState(false);

  const registerUser = useRegisterUser();

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    
    if (tg) {
      tg.ready();
      
      const tgUser = tg.initDataUnsafe?.user;
      const tgTheme = tg.colorScheme || "light";
      
      setTheme(tgTheme);
      if (tgTheme === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }

      if (tgUser) {
        setUser(tgUser);
        // Register user in background
        registerUser.mutate({
          data: {
            telegramUserId: tgUser.id.toString(),
            firstName: tgUser.first_name,
            lastName: tgUser.last_name,
            username: tgUser.username
          }
        });
      } else {
        // Fallback for dev
        setUser({
          id: 123456,
          first_name: "Demo",
          last_name: "User"
        });
      }
      
      tg.expand();
    } else {
      // Fallback for dev outside TG
      setUser({
        id: 123456,
        first_name: "Demo",
        last_name: "User"
      });
      document.documentElement.classList.remove("dark");
    }
    
    setIsReady(true);
  }, []);

  const value = {
    user,
    telegramUserId: user ? user.id.toString() : "demo_user_123",
    theme,
    isReady
  };

  return (
    <TelegramContext.Provider value={value}>
      {children}
    </TelegramContext.Provider>
  );
}

export function useTelegram() {
  const context = useContext(TelegramContext);
  if (!context) {
    throw new Error("useTelegram must be used within a TelegramProvider");
  }
  return context;
}
