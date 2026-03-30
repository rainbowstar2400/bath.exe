const { supabaseAdmin, getUser } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUser(req);
  if (!user) {
    return res.status(401).json({ error: '認証が必要です' });
  }

  let { notify_time, enabled, bath_time_type } = req.body;

  // notify_timeのバリデーション（iOSはHH:MM:SS形式を返すことがあるため秒を切り捨て）
  if (notify_time !== undefined) {
    notify_time = notify_time.slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(notify_time)) {
      return res.status(400).json({ error: '通知時刻の形式が不正です（HH:MM）' });
    }
    const [h, m] = notify_time.split(':').map(Number);
    if (h < 0 || h > 23 || m < 0 || m > 59) {
      return res.status(400).json({ error: '通知時刻の値が不正です' });
    }
  }

  // bath_time_typeのバリデーション
  if (bath_time_type !== undefined && !['night', 'morning'].includes(bath_time_type)) {
    return res.status(400).json({ error: 'お風呂のタイミングの値が不正です' });
  }

  // subscriptions テーブルを更新（通知許可済みユーザーのみ行が存在する）
  const updates = {};
  if (notify_time !== undefined) updates.notify_time = notify_time;
  if (enabled !== undefined) updates.enabled = enabled;
  if (bath_time_type !== undefined) updates.bath_time_type = bath_time_type;
  updates.updated_at = new Date().toISOString();

  const { data: updated, error } = await supabaseAdmin
    .from('subscriptions')
    .update(updates)
    .eq('user_id', user.id)
    .select('id');

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!updated || updated.length === 0) {
    return res.status(200).json({ ok: true, warning: '通知が未許可のため、通知設定は保存されませんでした' });
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
