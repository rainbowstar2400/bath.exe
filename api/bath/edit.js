const { supabaseAdmin, getUser } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUser(req);
  if (!user) {
    return res.status(401).json({ error: '認証が必要です' });
  }

  const { date, started_at, done_at } = req.body;

  // 日付のバリデーション
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: '日付が不正です' });
  }

  // 未来の日付はNG
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = jstNow.toISOString().split('T')[0];
  if (date > today) {
    return res.status(400).json({ error: '未来の日付には記録できません' });
  }

  // ユーザーの通知設定を取得（praise_level計算用）
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('notify_time')
    .eq('user_id', user.id)
    .single();

  const notifyTime = sub?.notify_time || '23:00';

  // praise_levelを再計算
  let praiseLevel = null;
  if (started_at) {
    const startedJst = new Date(new Date(started_at).getTime() + 9 * 60 * 60 * 1000);
    const [notifyH, notifyM] = notifyTime.split(':').map(Number);
    const startMinutes = startedJst.getUTCHours() * 60 + startedJst.getUTCMinutes();
    const notifyMinutes = notifyH * 60 + notifyM;
    praiseLevel = startMinutes < notifyMinutes ? 'excellent' : 'good';
  }

  // 既存レコードを確認
  const { data: existing } = await supabaseAdmin
    .from('bath_logs')
    .select('id')
    .eq('user_id', user.id)
    .eq('session_date', date)
    .single();

  if (existing) {
    // 更新
    const { error } = await supabaseAdmin
      .from('bath_logs')
      .update({
        started_at: started_at || null,
        done_at: done_at || null,
        praise_level: praiseLevel,
        is_manual: true,
      })
      .eq('id', existing.id);

    if (error) {
      console.error('入浴記録更新エラー:', error.message);
      return res.status(500).json({ error: '更新に失敗しました' });
    }
  } else {
    // 新規作成
    const { error } = await supabaseAdmin
      .from('bath_logs')
      .insert({
        user_id: user.id,
        session_date: date,
        started_at: started_at || null,
        done_at: done_at || null,
        notify_time: notifyTime,
        praise_level: praiseLevel,
        is_manual: true,
      });

    if (error) {
      console.error('入浴記録作成エラー:', error.message);
      return res.status(500).json({ error: '記録の作成に失敗しました' });
    }
  }

  return res.status(200).json({ ok: true });
};
