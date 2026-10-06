# PRAY — сайт + оффер на Netlify

Как hrwaest: репозиторий на GitHub → Netlify «Import from Git». Сайт — статика из `public/`, API клейма и скоринга — Netlify Functions, данные — Netlify Blobs. VPS не нужен.

```
public/index.html            готовый сайт (собирается из site/)
netlify/functions/api.mjs    все запросы /api/*
netlify/lib/core.mjs         маршруты и правила оффера
netlify/lib/scoring.mjs      скоринг: X (twitterapi.io), Hyperliquid, Lighter, Derive, Solana (Helius)
netlify/lib/store.mjs        хранилище клеймов (Netlify Blobs)
netlify/lib/xauth.mjs        Connect X: вход через X (OAuth 1.0a), сессия, проверка лайка
netlify/lib/sig.mjs          проверка подписи кошелька (EVM personal_sign, Solana signMessage)
netlify/lib/config.mjs       настройки по умолчанию
site/                        исходники сайта: src/part*.html, assets/, build.py
brand/                       логотип, фавикон, аватар и баннеры X
test/                        тесты (npm test) и локальный сервер с заглушками
```

## Деплой

1. **GitHub.** Создайте пустой приватный репозиторий и залейте содержимое папки:
   ```bash
   cd pray
   git init && git add . && git commit -m "PRAY site + offering"
   git branch -M main
   git remote add origin https://github.com/<you>/pray.git
   git push -u origin main
   ```
2. **Netlify.** Add new site → Import an existing project → GitHub → репозиторий `pray`. Netlify сам прочитает `netlify.toml`: publish `public`, functions `netlify/functions`, build command `npm test` (если тесты упадут, деплой не пройдёт). Нажмите Deploy.
3. **Ключи.** Site configuration → Environment variables → Add a variable:

   | Переменная | Обязательно | Что это |
   |---|---|---|
   | `HELIUS_API_KEY` | да | Solana-кошельки (dashboard.helius.dev) |
   | `TWITTERAPI_KEY` | да | профиль X и проверка Follow / Repost (twitterapi.io) |
   | `ADMIN_TOKEN` | да | любая длинная случайная строка, доступ к выгрузке |
   | `X_POST_ID` | когда выйдет пост | ID launch-поста (число из ссылки `.../status/ЧИСЛО`), включает проверку репоста |
   | `POOL_CAP_USD` | нет | бюджет пула, по умолчанию 25000 |
   | `X_ACCOUNT` | нет | по умолчанию `prayperpdex` |
   | `REQUIRE_TASKS` | нет | `false` — пускать без подписки/репоста |
   | `REFERRAL_RATE`, `REFERRAL_MAX_BONUS_USD` | нет | 0.10 и 0 (без потолка) |
   | `X_BEARER_TOKEN` | нет | официальный X API вместо twitterapi.io |
   | `X_CONSUMER_KEY` | да | Connect X: Consumer Key приложения в X Developer Console |
   | `X_CONSUMER_SECRET` | да | Connect X: Secret Key (secret) |
   | `SESSION_SECRET` | да | любая длинная случайная строка, подписывает cookie входа |
   | `REQUIRE_X_AUTH` | нет | `false` — пускать без Connect X (ник вводом, не рекомендуется) |
   | `REQUIRE_WALLET_SIG` | нет | `false` — клейм без подписи кошелька (не рекомендуется) |

   После добавления ключей: Deploys → Trigger deploy → Deploy site.
4. **Проверка.** Откройте `https://<site>.netlify.app/api/health` — должно быть `{"ok":true,...}`. На главной появится шкала пула: значит сайт видит бэкенд.
5. **Домен.** Domain management → Add a domain → `praydex.fun`. Дальше одно из двух:
   - перенести DNS в Netlify (Netlify DNS): у регистратора поменять NS на те, что покажет Netlify;
   - или оставить DNS у регистратора: `A @ → 75.2.60.5` и `CNAME www → <site>.netlify.app`.

   HTTPS (Let's Encrypt) Netlify включит сам, обычно за 5–30 минут.

Ключи никогда не попадают в репозиторий и в код страницы: `.env` в `.gitignore`, функции читают их из переменных Netlify.

## Как считается дроп

```
score  = Σ очков / Σ максимумов (только прочитанные источники) × 1000
amount = 0.5 + 9.5 × (score/1000)^1.6, вниз до $0.10, в пределах $0.50–$10
```

| EVM-кошелёк | Макс. | | Solana-кошелёк (Helius) | Макс. |
|---|---|---|---|---|
| X | 300 | | X | 300 |
| Hyperliquid | 400 | | Transactions | 250 |
| Lighter | 150 | | Wallet age | 200 |
| Derive | 150 | | Volume | 250 |

- Нет активности на кошельке → $0.50, даже если X сильный. Solana < 5 транзакций или < 30 дней → $0.50.
- X моложе 90 дней или бот → 40/300 вместо 0.
- 1 X = 1 кошелёк, 5 клеймов в час с одного IP, пул $25 000, дроп только на торговый баланс.
- Реферал: 10% от клейма друга, из того же пула; не засчитывается на себя, на неизвестного и с того же IP.
- Источник не ответил → 0 очков и флаг `needs_rescore` (пересчёт ниже).

## Connect X (вход через X)

1. X Developer Console → приложение → **User authentication settings** → OAuth 1.0a включён, App permissions: **Read**, Type: Web App.
   Callback URI (оба): `https://praydex.fun/api/x/callback` и `https://praydex.netlify.app/api/x/callback`. Website URL: `https://praydex.fun`.
2. В Netlify: `X_CONSUMER_KEY`, `X_CONSUMER_SECRET`, `SESSION_SECRET` → Trigger deploy.
3. Когда выйдет launch-пост: `X_POST_ID` = число из ссылки `.../status/ЧИСЛО`. Задания Like и Repost сразу станут обязательными, сайт пересобирать не нужно (настройки приходят из `/api/health`).

Как работает:
- Кнопка **Connect X** → `/api/x/login` → экран X «Authorize app» → `/api/x/callback`. Ник и id берутся из ответа X, токены лежат в Blobs (`xs/<id>`), в браузере только подписанная HttpOnly-cookie `pray_x` на 7 дней.
- Клейм берёт ник только из сессии X; ник из запроса игнорируется. В записи `xId` и `xVerified: true`.
- Проверки при клейме: подписка (twitterapi.io), репост (twitterapi.io: лента человека, затем ретвитнувшие), **лайк — по токену самого человека** (`GET /2/users/:id/liked_tweets`, лайки видит только владелец). Чего не хватает — «Almost there: like the launch post and repost the launch post…».
- Если X API не ответил (лимит, нет кредитов), задание не блокирует клейм и пишется как непроверенное.
- Стоимость X API (pay-per-use): вход — без платы за чтение; проверка лайка ≈ 10 записей за клейм. Пополняйте кредиты X перед запуском и смотрите расход в консоли.

## Подключение кошелька

Кошелёк человек по-прежнему добавляет просто вставкой адреса (задание Add your wallet). Подключить его нужно только на кнопке **Connect wallet & claim**:

1. Сайт находит кошелёк в браузере: EVM — MetaMask, Rabby, OKX, Coinbase и другие (EIP-6963 + `window.ethereum`); Solana — Phantom, Solflare, Backpack.
2. Если подключён другой адрес, человек видит «connected as 0x…, not 0x…» и может переключить аккаунт или одним нажатием взять подключённый.
3. Кошелёк подписывает текст: X-хендл, адрес и время. Подпись бесплатная, без газа и без approve.
4. Сервер проверяет подпись (`sig.mjs`, без зависимостей) и что ей не больше 15 минут. Чужой адрес (например, кит с Hyperliquid) без его ключа заклеймить нельзя.
5. На телефоне без кошелька в браузере: кнопка «Open in MetaMask» / «Open in Phantom» открывает сайт во встроенном браузере кошелька, хендл, адрес и выполненные задания переносятся в ссылке.

Смарт-контрактные кошельки (Safe и т. п., EIP-1271) не поддерживаются. WalletConnect (QR) — можно добавить позже, нужен project ID на reown.com.

## Админка

Все запросы с заголовком `Authorization: Bearer ADMIN_TOKEN`:

```bash
# выгрузка CSV (по 3000 строк; всего — в заголовке X-Total-Count)
curl -H "Authorization: Bearer $T" "https://praydex.fun/api/admin/claims.csv?offset=0&limit=3000" -o claims.csv
# пересчитать записи с needs_rescore (по 20 за вызов, повторять пока left > 0; сумма только растёт)
curl -X POST -H "Authorization: Bearer $T" https://praydex.fun/api/admin/rescore
# пересобрать итоги пула и рефералов из записей
curl -X POST -H "Authorization: Bearer $T" https://praydex.fun/api/admin/recount
```

Данные видны и в интерфейсе: Netlify → Blobs → store `pray-offering` (ключи `c/<handle>` — клеймы).

## Разработка

```bash
npm test                     # 58 проверок на заглушках, без сети и без Netlify
node test/dev-server.mjs     # сайт + API с заглушками: http://127.0.0.1:8790 (тестовые кошельки: /__dev/wallet)
DEV_X=1 node test/dev-server.mjs   # то же с Connect X и launch-постом (заглушка X)
python3 site/build.py        # пересобрать public/index.html после правок в site/src
```

С реальными ключами и Blobs локально: `npm i -g netlify-cli && netlify link && netlify dev`.

Настройки сайта — в `site/src/part4.html`: `PRAY_X`, `LAUNCH_POST` (ссылка на пост, когда выйдет), `SITE_URL` (реф-ссылки `https://praydex.fun/?ref=…`), `POOL_CAP`.

## Ограничения

- Лимит времени функции: клейм делает скоринг и проверку заданий параллельно, это 3–8 секунд. Список ретвитнувших читается до 3 страниц (`x.retweeterPages`); сначала проверяется лента самого человека, так что обычно хватает.
- Blobs не дают транзакций: при очень плотных одновременных клеймах итог пула может разойтись на копейки. `POST /api/admin/recount` пересобирает его из записей.
- X-аккаунт подтверждается входом через X, кошелёк — подписью. Лайки X проверить нельзя (скрыты с 2024 года).
- Поля Lighter и Derive разобраны по документации; после деплоя проверьте на живом кошельке:
  `curl -X POST https://praydex.fun/api/score -H 'content-type: application/json' -d '{"wallet":"0x…"}'`.
