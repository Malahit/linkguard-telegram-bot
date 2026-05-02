# OpenClaw — цифровая безопасность для подростков

> Telegram Mini App для проверки ссылок + образовательный канал о цифровой гигиене

OpenClaw — это проект, который помогает подросткам и взрослым безопасно жить в интернете. Без страха, но с умом.

## Что входит в проект

### 🔗 LinkGuard — Telegram Mini App
Личный помощник по проверке ссылок. Не родительский контроль — инструмент самого подростка.

- Вердикты: **Безопасно / Осторожно / Опасно / Неизвестно**
- Google Web Risk API + эвристический анализ (IP-адреса, фишинг-паттерны, сокращалки)
- Кнопка «Показать взрослому» — только по желанию, не навязывается
- История проверок, статистика, доверенные домены
- Светлая и тёмная тема (следует теме Telegram)

### 📢 Telegram-канал OpenClaw
Образовательный контент о цифровой гигиене для подростков и взрослых:
- Разборы реальных фишинговых атак
- Советы по паролям, двухфакторной аутентификации, приватности
- Объяснения на понятном языке, без технического жаргона

👉 **[t.me/openclaw](https://t.me/openclaw)**

---

## Стек технологий

| Часть | Технологии |
|---|---|
| Frontend (Mini App) | React 18, Vite, TypeScript, Tailwind CSS, Framer Motion |
| Backend (API) | Node.js 24, Express 5, TypeScript |
| База данных | PostgreSQL 16, Drizzle ORM |
| Валидация | Zod |
| API-контракт | OpenAPI 3.1, Orval (codegen) |
| Деплой | Docker Compose / Railway |

---

## Быстрый старт (локально)

```bash
# 1. Установить зависимости
pnpm install

# 2. Создать .env файл
cp .env.example .env
# Заполни DATABASE_URL и SESSION_SECRET

# 3. Применить схему БД
pnpm --filter @workspace/db run push

# 4. Запустить бэкенд
pnpm --filter @workspace/api-server run dev

# 5. Запустить фронтенд
pnpm --filter @workspace/link-checker-mini-app run dev
```

Фронтенд: http://localhost:PORT  
API: http://localhost:API_PORT/api/healthz

---

## Деплой

Подробные инструкции в [DEPLOY.md](./DEPLOY.md):

- **Railway** — один клик, бесплатный тариф, PostgreSQL включён
- **VPS + Docker Compose** — `docker compose up -d --build`
- **Ngrok** — для локального тестирования с Telegram

---

## Переменные окружения

```env
DATABASE_URL=postgresql://user:pass@host:5432/db
SESSION_SECRET=random_string_32_chars_minimum
GOOGLE_SAFE_BROWSING_API_KEY=   # опционально
```

---

## Структура проекта

```
├── artifacts/
│   ├── api-server/          # Express API сервер
│   │   └── src/
│   │       ├── lib/risk-engine.ts   # Логика проверки ссылок
│   │       └── routes/              # Маршруты API
│   └── link-checker-mini-app/       # React Mini App
│       └── src/
│           ├── pages/               # Home, Result, History, About, Settings
│           └── lib/telegram.tsx     # Telegram WebApp интеграция
├── lib/
│   ├── api-spec/openapi.yaml        # OpenAPI контракт (единый источник правды)
│   ├── api-client-react/            # React Query хуки (codegen)
│   ├── api-zod/                     # Zod схемы (codegen)
│   └── db/src/schema/               # Drizzle ORM схема БД
├── docker-compose.yml
├── Dockerfile.api
├── Dockerfile.frontend
├── railway.toml
└── DEPLOY.md
```

---

## Настройка Telegram Mini App

1. Напиши [@BotFather](https://t.me/BotFather) → `/newbot`
2. После создания: `Bot Settings → Menu Button → Edit menu button URL`
3. Укажи URL задеплоенного приложения
4. Готово — кнопка меню открывает Mini App

---

## Вклад в проект

OpenClaw — открытый проект. Если хочешь помочь:
- Открывай Issues с идеями и багами
- Pull Requests приветствуются
- Вопросы — в [канале](https://t.me/openclaw)

---

*OpenClaw — не родительский контроль. Это инструмент самого подростка.*
