const webpush = require('web-push');
const Anthropic = require('@anthropic-ai/sdk');
const { supabaseAdmin } = require('../_lib/supabase');
const { getSessionDate } = require('../_lib/session');

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const anthropic = new Anthropic();

// 段階ごとの通知生成プロンプト
const STAGE_PROMPTS = {
  1: 'やさしめに、お風呂に入ることを促す短い通知文（タイトルと本文）を生成して。フレンドリーな口調で。',
  2: '少し煽るような口調で、お風呂に入ることを促す短い通知文（タイトルと本文）を生成して。図星をつくような感じで。',
  3: '強めの圧で、お風呂に入ることを促す短い通知文（タイトルと本文）を生成して。もう逃げられない感じで。',
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // pg_cronからの認証チェック
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== process.env.PUSH_SECRET) {
    return res.status(401).json({ error: '認証エラー' });
  }

  const { stage } = req.body;
  if (![1, 2, 3].includes(stage)) {
    return res.status(400).json({ error: 'stage は 1〜3 を指定してください' });
  }

  const sessionDate = getSessionDate();

  // 通知が有効かつ、該当時刻のユーザーを取得
  // pg_cronは段階ごとに固定時刻で呼ぶため、notify_timeで絞り込む
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const jstH = jstNow.getUTCHours();
  const jstM = jstNow.getUTCMinutes();
  // 段階に応じたオフセットを引いて、設定時刻に該当するユーザーを絞る
  const offsetMinutes = (stage - 1) * 15;
  const targetM = (jstM - offsetMinutes + 60) % 60;
  const targetH = jstM < offsetMinutes ? (jstH - 1 + 24) % 24 : jstH;
  const targetTime = `${String(targetH).padStart(2, '0')}:${String(targetM).padStart(2, '0')}`;

  const { data: subscriptions, error } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('enabled', true)
    .eq('notify_time', targetTime);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // 当日の入浴ログを取得
  const { data: todayLogs } = await supabaseAdmin
    .from('bath_logs')
    .select('user_id')
    .gte('done_at', `${sessionDate}T03:00:00+00:00`);

  const doneUserIds = new Set((todayLogs || []).map(l => l.user_id));

  let sent = 0;
  for (const sub of subscriptions) {
    // 既に入浴済みならスキップ
    if (doneUserIds.has(sub.user_id)) continue;

    try {
      // Claude APIで通知文を動的生成
      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20241022',
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: STAGE_PROMPTS[stage] + '\nJSON形式で {"title": "...", "body": "..."} だけ返して。',
        }],
      });

      const text = message.content[0].text;
      // Claude APIがマークダウンで囲む場合があるためJSON部分を抽出
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('通知文のJSON解析に失敗:', text);
        continue;
      }
      const notification = JSON.parse(jsonMatch[0]);

      // バイブレーションパターン（段階に応じて長くする）
      const vibrate = {
        1: [200],
        2: [200, 100, 200],
        3: [300, 100, 300, 100, 300],
      };

      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { auth: sub.auth, p256dh: sub.p256dh },
        },
        JSON.stringify({
          title: notification.title,
          body: notification.body,
          vibrate: vibrate[stage],
        })
      );
      sent++;
    } catch (err) {
      // 410: サブスクリプション期限切れ → DB から削除
      if (err.statusCode === 410) {
        await supabaseAdmin
          .from('subscriptions')
          .delete()
          .eq('id', sub.id);
      }
      console.error(`通知送信エラー (user: ${sub.user_id}):`, err.message);
    }
  }

  return res.status(200).json({ sent });
};
