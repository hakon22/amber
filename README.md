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
  - `PORT` — порт HTTP‑сервера Express (по умолчанию `3011`).
- **PostgreSQL**
  - `DB` — режим подключения: `LOCAL` или `HOST`.
  - `DB_LOCAL` / `DB_HOST` — имя базы для локального и удалённого подключения.
  - `USER_DB_LOCAL` / `PASSWORD_DB_LOCAL` — логин/пароль для локальной БД.
  - `USER_DB_HOST` / `PASSWORD_DB_HOST` — логин/пароль для удалённой БД.
- **Docker (production)**
  - `DOCKER_USERNAME` — имя пользователя Docker Hub (образ собирается как `${DOCKER_USERNAME}/amber-bot:latest`).

Для production‑деплоя через Docker переменные задаются в `.env` на сервере (через `env_file` в docker-compose).

---

## Скрипты npm

- `npm run build` — компиляция TypeScript в `dist` (tsc + tsc-alias).
- `npm run start:bot:dev` — запуск бота в dev‑режиме (polling, `NODE_ENV=development`, через `tsx`).
- `npm run start:bot:prod` — запуск собранного бота (production, `node src/bot.js`; в Docker образе код лежит в `src` после копирования из `dist`).
- `npm run start:bot:docker:dev` — запуск бота в dev‑режиме внутри контейнера (собранный код, переменная `IS_DOCKER=TRUE`).
- `npm run lint` — проверка кода ESLint по `src`; автоисправление: `npm run lint -- --fix`.
- `npm run migration:create` — создание заготовки миграции (TypeORM).
- `npm run migration:create:name` — создание миграции с именем через хелпер.
- `npm run migration:run` — применение миграций (локальная БД, `DB=LOCAL`).
- `npm run migration:run:prod` — применение миграций на production (`DB=HOST`, используется в Docker).
- `npm run migration:revert` — откат последней миграции.

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

Образ — многоэтапная сборка (зависимости → сборка TypeScript → финальный образ с `dist/src` в `/app/src`, только нужные файлы):

```bash
docker build -t amber-bot .
```

Для пуша в Docker Hub (например, для CI):

```bash
docker build -t ${DOCKER_USERNAME}/amber-bot:latest .
docker push ${DOCKER_USERNAME}/amber-bot:latest
```

Запуск через `docker-compose.prod.yml`:

```bash
docker compose -f docker-compose.prod.yml up -d
```

В compose два сервиса:

- **migrations** — один раз выполняет `migration:run:prod`, затем завершается.
- **bot** — основной процесс (`start:bot:prod`), зависит от `migrations` и стартует после них.

Ожидается, что:

- в `.env` заданы переменные окружения и `DOCKER_USERNAME` для имени образа;
- логи пишутся в `/srv/logs` на хосте (volume в compose‑файле);
- приложение слушает порт **3011**.

### Development

Сборка и запуск через `docker-compose.dev.yml`:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Образ собирается из `Dockerfile.dev` (сборка в образе, в контейнере запускается `start:bot:docker:dev`). Порт **3011**, логи — в указанный каталог на хосте (в примере `C:/srv/logs`).

Сборка dev‑образа вручную:

```bash
docker build -f Dockerfile.dev -t amber-bot:dev .
docker run --rm -it --env-file .env -v /srv/logs:/srv/logs -p 3011:3011 amber-bot:dev start:bot:docker:dev
```

---

## Деплой (GitHub Actions)

При пуше в ветку `production` (или по ручному запуску workflow) выполняется:

1. Сборка Docker‑образа и push в Docker Hub (`DOCKER_USERNAME/amber-bot:latest`).
2. Копирование `docker-compose.prod.yml` на сервер.
3. На сервере: `docker pull`, `docker compose down`, `docker compose up -d`.

Необходимые секреты репозитория: `DOCKER_USERNAME`, `DOCKER_TOKEN`, `SERVER_HOST`, `SERVER_USER`, `AM_PROJECTS_SSH_PRIVATE_KEY`.

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
