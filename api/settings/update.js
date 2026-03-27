const { supabaseAdmin, getUser } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUser(req);
  if (!user) {
    return res.status(401).json({ error: '認証が必要です' });
  }

  const { notify_time, enabled } = req.body;

  // subscriptions テーブルを更新
  const updates = {};
  if (notify_time !== undefined) updates.notify_time = notify_time;
  if (enabled !== undefined) updates.enabled = enabled;
  updates.updated_at = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from('subscriptions')
    .update(updates)
    .eq('user_id', user.id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // 通知時刻が変更された場合、pg_cronジョブを更新
  // ※ pg_cronの動的更新はSupabaseのSQL経由で行う
  if (notify_time) {
    const [h, m] = notify_time.split(':').map(Number);
    // JST → UTC 変換
    const utcH = (h - 9 + 24) % 24;

    try {
      // 既存ジョブを削除して再登録
      await supabaseAdmin.rpc('update_cron_jobs', {
        utc_hour: utcH,
        utc_minute: m,
      });
    } catch (err) {
      console.error('pg_cronジョブ更新エラー:', err.message);
      // ジョブ更新失敗は通知設定自体には影響しないのでエラーにはしない
    }
  }

  return res.status(200).json({ ok: true });
};
