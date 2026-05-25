# LinkGuard — Telegram-бот для проверки ссылок

> Образовательный проект под брендом **OpenClaw** для канала [@bezstrahavseti](https://t.me/bezstrahavseti) — «Без страха в сети»

LinkGuard помогает подросткам и взрослым проверить любую ссылку на фишинг и скам — прямо в Telegram, без лишних приложений.

---

## Как работает

Отправь боту любую ссылку — он проверит её через AI-анализ (Perplexity sonar) и вернёт вердикт:

**Безопасно / Осторожно / Опасно / Неизвестно**

---

## Стек технологий

| Часть | Технологии |
|---|---|
| Runtime | Node.js 24, TypeScript |
| Фреймворк | Express 5 |
| База данных | PostgreSQL 16, Drizzle ORM |
| AI-анализ | Perplexity API (модель `sonar`) через OpenAI-совместимый клиент |
| Telegram | Webhook-режим (`/api/webhook/telegram`) |
| Деплой | Docker Compose + nginx (VPS) |
| Монорепо | pnpm workspaces |

---

## Структура проекта

```
├── artifacts/
│   └── api-server/          # Основной сервер (порт 8081)
│       └── src/
│           ├── routes/      # Маршруты API и Telegram webhook
│           └── lib/         # AI-анализ, риск-движок
├── nginx/                   # Конфиг nginx (:80/:443 → api:8081)
├── docs/                    # Документация проекта
├── scripts/                 # Вспомогательные скрипты
├── lib/                     # Общие библиотеки (db, типы)
├── CONTENT_PLAN.md          # 30-дневный план постов для канала
├── DEPLOY.md                # Инструкция по деплою на VPS
├── docker-compose.yml       # Production-конфиг
├── Dockerfile.api
└── .env.example             # Шаблон переменных окружения
```

---

## Быстрый старт (локально)

```bash
# 1. Установить зависимости
pnpm install

# 2. Создать .env файл из шаблона
cp .env.example .env
# Заполни TELEGRAM_BOT_TOKEN, OPENAI_API_KEY, DATABASE_URL

# 3. Запустить базу данных
docker compose up db -d

# 4. Применить схему БД
pnpm --filter @workspace/api-server run db:push

# 5. Запустить сервер
pnpm --filter @workspace/api-server run dev
```

Для тестирования webhook локально используй ngrok:

```bash
ngrok http 8081
# Укажи полученный URL в TELEGRAM_WEBHOOK_URL в .env
```

---

## Деплой на VPS

Подробные инструкции в [DEPLOY.md](./DEPLOY.md).

Краткий порядок:

```bash
git pull origin main
docker compose down
docker compose up -d --build
```

Nginx проксирует `:80` / `:443` → `api:8081`. Webhook регистрируется автоматически при старте сервера.

---

## Переменные окружения

Полный шаблон — в [`.env.example`](./.env.example).

| Переменная | Описание | Обязательна |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен бота от @BotFather | ✅ |
| `OPENAI_API_KEY` | Ключ Perplexity API | ✅ |
| `OPENAI_BASE_URL` | `https://api.perplexity.ai` | ✅ |
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `POSTGRES_PASSWORD` | Пароль PostgreSQL (для Docker) | ✅ |
| `SESSION_SECRET` | Случайная строка ≥ 64 символа | ✅ |
| `OPENCLAW_CHANNEL_ID` | ID канала (`@bezstrahavseti`) | ✅ |
| `VIRUSTOTAL_API_KEY` | Ключ VirusTotal (500 req/day бесплатно) | ✅ |
| `ADMIN_CHAT_ID` | Твой Telegram ID для алертов | опционально |

---

## Контент-план канала

30-дневный план постов по рубрикам `#гигиена`, `#разбор`, `#инструмент`, `#проверь_себя`, `#история` описан в [`CONTENT_PLAN.md`](./CONTENT_PLAN.md). Автоматическая публикация настроена в `scheduler.ts`.

---

## Вклад в проект

- Баги и идеи → [Issues](https://github.com/Malahit/linkguard-telegram-bot/issues)
- Pull Requests приветствуются
- Канал → [@bezstrahavseti](https://t.me/bezstrahavseti)

---

*OpenClaw — не родительский контроль. Это инструмент самого пользователя.*
