## Amber Telegram Bot

Телеграм-бот для ответов пользователям с помощью ИИ (база знаний, уточняющие вопросы) и логированием диалогов в PostgreSQL. Веб‑интерфейса для конечного пользователя нет — только бот. Режимы запуска:

- **development** — polling (бот сам опрашивает Telegram);
- **production** — webhook (обновления приходят в Express по HTTP).

### Возможности

- Текстовые вопросы по эксплуатации и обслуживанию авто; при низкой уверенности поиска по базе знаний бот может задать уточнение.
- **Профиль авто** — команда `/profile` (модель, год, пробег); учитывается в ответах.
- **Файлы и фото** — PDF, изображения и др.; текст извлекается, при необходимости ответ строится по содержимому и подписи.
- **Голосовые сообщения** — распознавание через Yandex SpeechKit (короткое аудио, до ~1 МБ), затем тот же сценарий, что и для текста.
- **Долгий ответ** — показывается спиннер с кнопкой **«Остановить»**; также команда **`/stop`** прерывает ожидание ответа в UI (запрос к модели в фоне может ещё завершиться).
- **Обратная связь** — кнопки «Полезно / Не полезно» под ответом; при «Не полезно» можно оставить текст корректировки.
- **Администратор** — загрузка записей в базу знаний (текст + файлы), рассылка ошибок в production на `TELEGRAM_CHAT_ID`.

---

## Стек

- **Node.js**, **TypeScript**
- **Telegraf** — Telegram Bot API
- **Express** — HTTP‑сервер для webhook‑режима
- **TypeORM + PostgreSQL (с pgvector для RAG)** — ORM и база данных
- **LangChain** — агенты и вызовы LLM
- **typescript-ioc** — IoC‑контейнер
- **winston** — логирование в файлы с ротацией
- **Yandex Object Storage (S3)** — хранение файлов пользователей и вложений знаний
- Docker / docker-compose для деплоя

---

## Переменные окружения

Основные переменные (файл `.env`):

- **Telegram / сеть**
  - `TELEGRAM_BOT_TOKEN` — токен Telegram‑бота.
  - `TELEGRAM_WEBHOOK_URL` — публичный URL webhook (например, `https://your-host/telegram/webhook`), для production.
  - `TELEGRAM_CHAT_ID`, `TELEGRAM_CHAT_ID2` — опционально: админские чаты (уведомления об ошибках, рассылка).
  - `PROXY_USER`, `PROXY_PASS`, `PROXY_HOST` — опционально, SOCKS‑прокси для Telegram.
- **Голос**
  - `YANDEX_VOICE_API_KEY` — API‑ключ Yandex Cloud для распознавания голосовых (SpeechKit STT). Без ключа голосовые обрабатываться не будут (ошибка при запросе).
- **Yandex S3 (файлы)**
  - `YANDEX_S3_BUCKET`, `YANDEX_S3_ENDPOINT`, `YANDEX_S3_ACCESS_KEY_ID`, `YANDEX_S3_SECRET_ACCESS_KEY`, `YANDEX_S3_ACCOUNT_ID`, при необходимости `YANDEX_S3_PUBLIC_ENDPOINT`, `YANDEX_S3_REGION`.
- **Режимы запуска**
  - `NODE_ENV` — `development` или `production` (polling / webhook).
  - `PORT` — порт Express (по умолчанию `3011`).
  - `APP_NAME` — имя приложения в тексте служебных уведомлений.
- **PostgreSQL**
  - `DB` — `LOCAL` или `HOST`.
  - `DB_LOCAL` / `DB_HOST` — имя базы.
  - `USER_DB_LOCAL` / `PASSWORD_DB_LOCAL`, `USER_DB_HOST` / `PASSWORD_DB_HOST` — учётные данные.
- **Docker (production)**
  - `DOCKER_USERNAME` — пользователь Docker Hub (образ `${DOCKER_USERNAME}/amber-bot:latest`).

Переменные для LLM и эмбеддингов задаются в настройках агентов в БД (см. сущности агентов / миграции).

---

## Скрипты npm

- `npm run build` — компиляция TypeScript в `dist` (tsc + tsc-alias).
- `npm run start:bot:dev` — polling, `NODE_ENV=development`, `tsx`.
- `npm run start:bot:prod` — production, `node src/bot.js`.
- `npm run start:bot:docker:dev` — dev внутри контейнера (`IS_DOCKER=TRUE`).
- `npm run lint` — ESLint; автоисправление: `npm run lint -- --fix`.
- `npm run migration:create` / `migration:create:name` / `migration:run` / `migration:run:prod` / `migration:revert` — миграции TypeORM.

---

## Локальный запуск

1. `npm ci`
2. Настроить `.env` (токен бота, БД, при необходимости S3 и `YANDEX_VOICE_API_KEY`).
3. При необходимости: `npm run migration:run`
4. `npm run start:bot:dev`

---

## Сборка и запуск в Docker

### Production

```bash
docker build -t amber-bot .
docker compose -f docker-compose.prod.yml up -d
```

Сервисы: **migrations** (однократно), затем **bot**. Порт **3011**, логи — volume на хосте.

### Development

```bash
docker compose -f docker-compose.dev.yml up -d
```

---

## Деплой (GitHub Actions)

Пуш в `production` (или ручной запуск): сборка образа, push в Docker Hub, на сервере `pull` и `compose up`.

Секреты: `DOCKER_USERNAME`, `DOCKER_TOKEN`, `SERVER_HOST`, `SERVER_USER`, `AM_PROJECTS_SSH_PRIVATE_KEY`.

---

## Режимы работы (кратко)

- **Development**: `deleteWebhook`, `bot.launch()` (polling), Express без активного webhook.
- **Production**: `setWebhook(TELEGRAM_WEBHOOK_URL)`, обновления на `/telegram/webhook`.
