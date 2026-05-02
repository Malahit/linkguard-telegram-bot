# Деплой LinkGuard

## Вариант 1: Railway (рекомендуется, бесплатный тариф)

Railway — самый простой способ запустить бота с базой данных за 5 минут.

### Шаги:

1. Зарегистрируйся на [railway.app](https://railway.app)

2. Создай новый проект → **Deploy from GitHub repo** → выбери `linkguard-telegram-bot`

3. Добавь базу данных:
   - В проекте нажми **+ New** → **Database** → **PostgreSQL**
   - Railway автоматически добавит `DATABASE_URL` в переменные окружения

4. Настрой переменные окружения для API-сервиса:
   ```
   NODE_ENV=production
   SESSION_SECRET=<случайная строка 32+ символа>
   GOOGLE_SAFE_BROWSING_API_KEY=<опционально>
   ```

5. Railway автоматически применит конфиг из `railway.toml` и задеплоит API.

6. Для фронтенда — создай второй сервис в том же проекте, выбери `Dockerfile.frontend`.

7. Получи публичный URL и используй его как адрес Telegram Mini App.

---

## Вариант 2: VPS с Docker Compose (полный контроль)

Подойдёт для DigitalOcean, Hetzner, любого VPS с Ubuntu 22.04+.

### Требования:
- VPS с Ubuntu 22.04 (минимум 1 CPU, 1 GB RAM)
- Домен с DNS-записью A → IP сервера
- Docker + Docker Compose установлены

### Установка Docker:
```bash
curl -fsSL https://get.docker.com | sh
```

### Деплой:

```bash
# 1. Клонируй репозиторий
git clone https://github.com/Malahit/linkguard-telegram-bot
cd linkguard-telegram-bot

# 2. Скопируй и заполни переменные окружения
cp .env.example .env
nano .env   # заполни POSTGRES_PASSWORD, SESSION_SECRET и т.д.

# 3. Создай папку для SSL-сертификатов (если нужен HTTPS)
mkdir -p nginx/certs

# 4. Запусти
docker compose up -d --build

# 5. Проверь что всё работает
docker compose ps
curl http://localhost:8080/api/healthz
```

### Применить миграции БД:
```bash
docker compose exec api node -e "
const { db } = await import('./artifacts/api-server/dist/index.mjs');
"
# Или вручную через pnpm --filter @workspace/db run push (в dev-окружении)
```

### Обновление кода:
```bash
git pull
docker compose up -d --build
```

### Просмотр логов:
```bash
docker compose logs -f api
docker compose logs -f frontend
```

---

## Вариант 3: Telegram Mini App без деплоя (локальный туннель)

Для тестирования можно использовать ngrok:

```bash
# Запусти приложение локально
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev &
pnpm --filter @workspace/link-checker-mini-app run dev &

# Создай туннель (нужен аккаунт ngrok)
ngrok http 80
```

Полученный URL `https://xxxx.ngrok.io` используй как адрес Mini App в BotFather.

---

## Настройка Telegram Mini App

1. Напиши [@BotFather](https://t.me/BotFather) в Telegram
2. Создай нового бота: `/newbot`
3. Настрой Menu Button:
   ```
   /mybots → выбери бота → Bot Settings → Menu Button → Edit menu button URL
   ```
   Укажи URL твоего задеплоенного приложения.
4. Включи inline mode если нужно: `/setinline`

---

## Google Web Risk API (опционально)

Без ключа бот работает только на эвристиках. С ключом — подключается Google Safe Browsing.

1. Открой [Google Cloud Console](https://console.cloud.google.com)
2. Создай проект
3. Включи **Web Risk API**
4. Создай API-ключ: APIs & Services → Credentials → Create Credentials
5. Добавь ключ в `.env` или Railway как `GOOGLE_SAFE_BROWSING_API_KEY`
