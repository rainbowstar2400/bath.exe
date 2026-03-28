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
| セッションリセット | 毎日12:00（正午）に新セッション開始 |
| 通知時刻変更 | 設定変更時にAPIでpg_cronジョブも更新 |

---

## Phase 1: 環境セットアップ

- [ ] Supabase プロジェクト新規作成
- [ ] Vercel プロジェクト作成・GitHub リポジトリ連携
- [ ] VAPID 鍵ペア生成
- [ ] 環境変数設定（Vercel・Supabase 両方）

---

## Phase 2: DB スキーマ構築

- [ ] `subscriptions` テーブル作成
- [ ] `chat_sessions` テーブル作成
- [ ] `pg_net` / `pg_cron` 拡張を有効化
- [ ] pg_cron ジョブ登録（23:00・23:15・23:30）

### subscriptions テーブル（案）

| カラム | 型 | 説明 |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | Supabase 匿名認証のユーザーID |
| endpoint | text | プッシュエンドポイント |
| auth | text | VAPID auth キー |
| p256dh | text | VAPID p256dh キー |
| notify_time | time | 通知開始時刻（デフォルト 23:00） |
| enabled | boolean | 通知オンオフ |
| created_at | timestamptz | 作成日時 |

### chat_sessions テーブル（案）

| カラム | 型 | 説明 |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | Supabase 匿名認証のユーザーID |
| messages | jsonb | 会話履歴（Claude API 形式） |
| date | date | セッションの日付（毎日12:00リセット） |
| created_at | timestamptz | 作成日時 |

---

## Phase 3: バックエンド API（Vercel サーバーレス関数）

- [ ] `POST /api/subscriptions/register` — サブスク登録・更新
- [ ] `POST /api/push/send` — プッシュ通知送信（pg_cron から叩かれる）
- [ ] `POST /api/chat` — Claude API とのやり取り
- [ ] `POST /api/bath/done` — 「入った！」処理・残り通知キャンセル・褒めメッセージ生成
- [ ] `POST /api/settings/update` — 通知時刻変更・pg_cron ジョブ更新

---

## Phase 4: フロントエンド（PWA）

- [ ] `manifest.json` + アイコン
- [ ] Service Worker（プッシュ受信・通知表示）
- [ ] 初回起動フロー（通知許可 → サブスク登録）
- [ ] メイン画面（チャット・「今すぐ煽って」ボタン・「入った！」ボタン）
- [ ] 設定画面（通知時刻・オンオフ）

---

## Phase 4.5: 時計表示と入浴タイマー

- [ ] メイン画面上部に現在時刻を大きめに表示（毎分更新）
- [ ] 見積もりメッセージ表示（「今入れば XX:XX には出れるよ！」）
- [ ] フェーズ連動（「今はいる！」後 →「XX:XX くらいには出れるね！」、「はいった！」後 →「今日は XX:XX に入れました！」）
- [ ] 設定画面に「お風呂の時間」セレクトボックス追加（5分刻み、5〜90分、デフォルト20分）
- [ ] Tips テキスト表示（「少し長めに見積もっておくのがおすすめです」）
- [ ] localStorage で所要時間を保存・読み込み

---

## Phase 5: 結合・動作確認

- [ ] 通知の手動テスト（時刻を早めて確認）
- [ ] チャットフロー確認
- [ ] 「入った！」で残り通知がキャンセルされるか確認
- [ ] 設定変更 → pg_cron 更新の確認

---

## Phase 6: デプロイ・仕上げ

- [ ] Vercel にデプロイ
- [ ] HTTPS で PWA インストール確認
- [ ] 実機でプッシュ通知確認
