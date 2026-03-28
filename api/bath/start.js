const { supabaseAdmin, getUser } = require('../_lib/supabase');
const { getSessionDate } = require('../_lib/session');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUser(req);
  if (!user) {
    return res.status(401).json({ error: '認証が必要です' });
  }

  const sessionDate = getSessionDate();

  // 当日のレコードが既にあるかチェック
  const { data: existing } = await supabaseAdmin
    .from('bath_logs')
    .select('id')
    .eq('user_id', user.id)
    .eq('session_date', sessionDate)
    .single();

  if (existing) {
    return res.status(409).json({ error: '本日は既に記録があります', log_id: existing.id });
  }

  // ユーザーの通知設定を取得
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('notify_time')
    .eq('user_id', user.id)
    .single();

  const notifyTime = sub?.notify_time || '23:00';

  const { data, error } = await supabaseAdmin
    .from('bath_logs')
    .insert({
      user_id: user.id,
      session_date: sessionDate,
      started_at: new Date().toISOString(),
      notify_time: notifyTime,
    })
    .select('id, started_at')
    .single();

  if (error) {
    console.error('入浴開始記録エラー:', error.message);
    return res.status(500).json({ error: '記録に失敗しました' });
  }

  return res.status(200).json({ log_id: data.id, started_at: data.started_at });
};
