## Amber Telegram Bot

Телеграм-бот для ответов пользователям с помощью ИИ и логированием диалогов в PostgreSQL. Проект предназначен только для хостинга бота (без веб‑интерфейса для пользователя), с возможностью работы в двух режимах:

- **development** — polling (бот сам опрашивает Telegram);
- **production** — webhook (обновления приходят в Express по HTTP).

---

## Стек

- **Node.js**, **TypeScript**
- **Telegraf** — Telegram Bot API
- **Express** — HTTP‑сервер для webhook‑режима
- **TypeORM + PostgreSQL** — ORM и база данных
- **typescript-ioc** — IoC‑контейнер
- **winston** — логирование в файлы с ротацией
- Docker / docker-compose для деплоя

---

## Переменные окружения

Основные переменные (файл `.env`):

- **Telegram / сеть**
  - `TELEGRAM_BOT_TOKEN` — токен Telegram‑бота.
  - `TELEGRAM_WEBHOOK_URL` — публичный URL webhook‑эндпоинта (например, `https://your-host/telegram/webhook`), используется в production.
  - `PROXY_USER`, `PROXY_PASS`, `PROXY_HOST` — опционально, настройки SOCKS‑прокси для Telegram.
- **Режимы запуска**
  - `NODE_ENV` — `development` или `production` (определяет polling / webhook режим).
  - `PORT` — порт HTTP‑сервера Express (по умолчанию `3010`).
- **PostgreSQL**
  - `DB` — режим подключения: обычно `LOCAL`.
  - `DB_LOCAL` / `DB_HOST` — имя базы для локального и удалённого подключения.
  - `USER_DB_LOCAL` / `PASSWORD_DB_LOCAL` — логин/пароль для локальной БД.
  - `USER_DB_HOST` / `PASSWORD_DB_HOST` — логин/пароль для удалённой БД.

Для production‑деплоя через Docker переменные задаются в `.env` на сервере (через `env_file` в docker-compose).

---

## Скрипты npm

- `npm run build` — компиляция TypeScript в `dist`.
- `npm run start:bot:dev` — запуск бота в dev‑режиме (polling, `NODE_ENV=development`, через `tsx`).
- `npm run start:bot:prod` — запуск собранного бота из `dist` (используется в production‑образе Docker).
- `npm run lint` — запуск ESLint по `src`.
- `npm run migration:run` — применение миграций БД (в режиме development).

---

## Локальный запуск

1. Установить зависимости:

```bash
npm ci
```

2. Настроить `.env` (минимум `TELEGRAM_BOT_TOKEN` и параметры БД).

3. При необходимости применить миграции:

```bash
npm run migration:run
```

4. Запустить в режиме разработки (polling):

```bash
npm run start:bot:dev
```

Бот подключится к Telegram по токену и начнёт опрашивать обновления.

---

## Сборка и запуск в Docker

### Production

Образ — многоэтапная сборка (зависимости → сборка TypeScript → финальный образ только с `dist` и зависимостями):

```bash
docker build -t amber-bot .
```

Запуск через `docker-compose.prod.yml`:

```bash
docker compose -f docker-compose.prod.yml up -d
```

Ожидается, что:

- переменные окружения заданы в `.env` рядом с `docker-compose.prod.yml`;
- логи пишутся в `/srv/logs` на хосте (volume в compose‑файле);
- в образе по умолчанию выполняется `npm run start:bot:prod`.

### Development

Образ для разработки (polling, без сборки — запуск через `tsx`):

```bash
docker build -f Dockerfile.dev -t amber-bot:dev .
docker run --rm -it --env-file .env -v /srv/logs:/srv/logs amber-bot:dev
```

Для hot-reload можно монтировать исходники:

```bash
docker run --rm -it --env-file .env -v "$(pwd)/src:/app/src" -v /srv/logs:/srv/logs amber-bot:dev
```

(На Windows в Git Bash путь к проекту: `-v "$(pwd)/src:/app/src"` или укажите полный путь к `src`.)

---

## Режимы работы (кратко)

- **Development (polling)**:
  - `NODE_ENV=development`;
  - в `bot.ts` webhook удаляется (`deleteWebhook`), запускается `bot.launch()`;
  - Express поднимается, но webhook‑маршрут Telegram не использует.

- **Production (webhook)**:
  - `NODE_ENV=production`;
  - ожидается `TELEGRAM_WEBHOOK_URL`;
  - `bot.ts` вызывает `bot.telegram.setWebhook(TELEGRAM_WEBHOOK_URL)`;
  - Telegram шлёт обновления на `/telegram/webhook`, Express прокидывает их в Telegraf.
