# Инструкция по деплою на Railway

## Шаг 1: Регистрация на Railway

1. Перейдите на https://railway.app
2. Нажмите "Login" и войдите через GitHub
3. Подтвердите доступ к вашему GitHub аккаунту

## Шаг 2: Создание проекта

1. В Railway нажмите "New Project"
2. Выберите "Deploy from GitHub repo"
3. Выберите репозиторий `Feym4n/FlickPick`
4. Railway автоматически определит Next.js и начнет деплой

## Шаг 3: Настройка переменных окружения

В настройках проекта (Settings → Variables) добавьте:

```
KINOPOISK_API_KEY=ваш_ключ_кинопоиск
NEXT_PUBLIC_SOCKET_URL=https://ваш-проект.railway.app
ALLOWED_ORIGINS=https://ваш-проект.railway.app
```

**Важно:** Railway автоматически предоставляет переменную `PORT`, но Next.js использует порт 3000 по умолчанию.

## Шаг 4: Настройка Firebase

Убедитесь, что переменные окружения Firebase добавлены:
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`

## Шаг 5: Получение URL

После деплоя Railway предоставит URL вида:
`https://ваш-проект.up.railway.app`

Этот URL можно использовать для доступа к приложению.

## Преимущества Railway для Socket.IO:

✅ Постоянные процессы (не serverless)
✅ Нет холодного старта
✅ Стабильные WebSocket соединения
✅ Бесплатный план с 500 часами в месяц
✅ Автоматический деплой из GitHub

## Отличия от Vercel:

- Railway использует постоянные процессы, а не serverless функции
- Socket.IO будет работать стабильнее
- Нет проблем с переподключением
- Меньше задержек

