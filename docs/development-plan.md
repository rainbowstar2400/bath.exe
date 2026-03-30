# Bath.exe 開発手順

## コンセプト

「入りたいのに入れない」を解決するPWAアプリ。
外から強制的に煽ってもらい、チャットで駄々をこねても最終的にお風呂に送り込まれる。

---

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フロント | PWA（HTML/JS）+ Service Worker |
| バックエンド | Vercel サーバーレス関数 |
| プッシュ通知 | Web Push API + `web-push`ライブラリ（VAPID認証） |
| AI | Claude API（claude-sonnet-4-20250514） |
| DB | Supabase（新規プロジェクト） |
| 定時実行 | Supabase pg_cron |
| 認証 | Supabase 匿名認証 |

---

## 決定事項

| 項目 | 内容 |
|---|---|
| チャット履歴 | `chat_sessions` テーブルで管理 |
| 通知オフ時 | `enabled` フラグで管理（レコードは削除しない） |
| 「入った！」ボタン | 残り通知をキャンセルし、褒めメッセージを表示 |
| 褒め方 | 早い時間 → 激褒め、遅い時間でも「入っただけ偉い！」 |
| セッションリセット | 境界時刻でリセット（夜風呂派:正午、朝風呂派:早朝4時） |
| 通知時刻変更 | 設定変更時にAPIでpg_cronジョブも更新 |

---

## Phase 1: 環境セットアップ ✅

- [x] Supabase プロジェクト新規作成
- [x] Vercel プロジェクト作成・GitHub リポジトリ連携
- [x] VAPID 鍵ペア生成
- [x] 環境変数設定（Vercel・Supabase 両方）

---

## Phase 2: DB スキーマ構築 ✅

- [x] `subscriptions` テーブル作成
- [x] `chat_sessions` テーブル作成
- [x] `bath_logs` テーブル作成（`session_date`, `started_at`, `done_at`, `is_manual` 等）
- [x] `pg_net` / `pg_cron` 拡張を有効化
- [x] pg_cron ジョブ登録（23:00・23:15・23:30）
- [x] `subscriptions` に `bath_time_type` カラム追加（朝風呂派/夜風呂派）

### subscriptions テーブル

最新のスキーマは仕様書 5.1 を参照。

### chat_sessions テーブル

最新のスキーマは仕様書 5.2 を参照。

### bath_logs テーブル

最新のスキーマは仕様書 5.3 を参照。

---

## Phase 3: バックエンド API（Vercel サーバーレス関数） ✅

- [x] `POST /api/subscriptions/register` — サブスク登録・更新（notify_time/bath_time_type も送信可）
- [x] `POST /api/push/send` — プッシュ通知送信（pg_cron から叩かれる）
- [x] `POST /api/chat` — Claude API とのやり取り（セッション管理・上限制御付き）
- [x] `POST /api/bath/start` — 「今はいる！」処理・入浴開始記録
- [x] `POST /api/bath/done` — 「はいった！」処理・褒めメッセージ生成
- [x] `POST /api/bath/edit` — 入浴記録の手動編集・追加（バリデーション付き）
- [x] `GET /api/stats` — 記録画面用データ取得（スライディング7日間）
- [x] `POST /api/settings/update` — 通知設定・bath_time_type 更新
- [x] `GET /api/settings` — 通知設定取得（エラーコード区別対応済み）
- [x] `GET /api/config` — フロントへ公開設定配信

---

## Phase 4: フロントエンド（PWA） ✅

- [x] `manifest.json` + アイコン
- [x] Service Worker（プッシュ受信・通知表示・キャッシュ）
- [x] 初回起動オンボーディング（5ステップポップアップ：ようこそ → 通知時刻 → お風呂の時間 → 通知許可 → 完了）
- [x] メイン画面（チャット・2段階入浴ボタン）
- [x] 設定画面（通知時刻・オンオフ・お風呂の時間・お風呂のタイミング）
- [x] 認証トークン自動更新（onAuthStateChange）
- [x] 公開設定のAPI経由取得（/api/config）

---

## Phase 4.5: 時計表示と入浴タイマー ✅

- [x] メイン画面上部に現在時刻を大きめに表示（毎秒更新、秒は小さめ）
- [x] 見積もりメッセージ表示（「今入れば XX:XX には出れるよ！」）
- [x] フェーズ連動（「今はいる！」後 →「XX:XX くらいには出れるね！」、「はいった！」後 →「今日は XX:XX に入れました！」）
- [x] 設定画面に「お風呂の時間」セレクトボックス追加（5分刻み、5〜90分、デフォルト20分）
- [x] Tips テキスト表示（「少し長めに見積もっておくのがおすすめです」）
- [x] localStorage で所要時間を保存・読み込み

---

## Phase 4.6: チャット履歴と設定の永続化 ✅

- [x] リロード時にサーバーからチャット履歴を読み込み表示
- [x] 設定画面で保存済みの通知時刻・ON/OFFをサーバーから取得して表示（`GET /api/settings`）

---

## Phase 4.7: 記録画面 ✅

- [x] カード型UIで過去7日分の入浴記録を表示（スライディングウィンドウ）
- [x] 入/出バッジ（青/コーラル色分け）+ かかった時間表示
- [x] 入浴開始記録（`started_at`）対応
- [x] 推測値表示（`done_at` がない場合は設定の所要時間から推測）
- [x] 記録の手動編集・追加モーダル
- [x] 翌日またぎの `（翌）` 表示
- [x] 連続記録（streak）表示

## Phase 4.8: 朝風呂派/夜風呂派設定 ✅

- [x] 設定画面にセレクト + 動的Tips追加
- [x] セッション日付境界をユーザー設定に応じて切替（夜風呂派=12:00、朝風呂派=4:00）
- [x] 全APIエンドポイントで設定を反映（start, done, stats, chat, push）

---

## Phase 5: 結合・動作確認

- [x] チャットフロー確認
- [ ] 通知の手動テスト（時刻を早めて確認）
- [ ] 「入った！」で残り通知がキャンセルされるか確認
- [ ] 設定変更 → pg_cron 更新の確認
- [ ] 記録画面の実データ確認

---

## Phase 6: デプロイ・仕上げ

- [x] Vercel にデプロイ
- [ ] HTTPS で PWA インストール確認
- [ ] 実機でプッシュ通知確認
- [ ] Supabase CDN をバージョン固定し SRI ハッシュを付与
- [ ] `manifest.json` に `scope` と `description` を追加
- [ ] Push通知エンドポイントのレート制限を検討・実装
