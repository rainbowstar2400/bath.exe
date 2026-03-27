# Bath.exe

「入りたいのに入れない」を解決するPWAアプリ。

## 技術スタック

- フロント: PWA（HTML/JS）+ Service Worker
- バックエンド: Vercel サーバーレス関数
- プッシュ通知: Web Push API + `web-push`（VAPID認証）
- AI: Claude API（claude-sonnet-4-20250514）
- DB: Supabase
- 定時実行: Supabase pg_cron + pg_net
- 認証: Supabase 匿名認証

## ディレクトリ構成

- `docs/` — 仕様書・開発手順
- `api/` — Vercel サーバーレス関数
- `public/` — PWA フロントエンド（HTML/JS/CSS/manifest.json/Service Worker）

## コーディング規約

- コメント・コミットメッセージは日本語
- コミットメッセージは Conventional Commits 形式（`feat:`, `fix:`, `docs:` など）

## ドキュメント

- 仕様書: `docs/specification.md`
- 開発手順: `docs/development-plan.md`
