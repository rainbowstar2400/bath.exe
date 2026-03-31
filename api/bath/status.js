const { supabaseAdmin, getUser } = require('../_lib/supabase');
const { getSessionDate, getBathTimeType } = require('../_lib/session');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUser(req);
  if (!user) {
    return res.status(401).json({ error: '認証が必要です' });
  }

  // 進行中の入浴（done_atがnull、started_atがある）を検索
  const { data: inProgress } = await supabaseAdmin
    .from('bath_logs')
    .select('id, started_at')
    .eq('user_id', user.id)
    .is('done_at', null)
    .not('started_at', 'is', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  if (inProgress) {
    return res.status(200).json({ phase: 'done', log_id: inProgress.id, started_at: inProgress.started_at });
  }

  // 今日のセッションで完了済みの入浴があるかチェック
  const bathTimeType = await getBathTimeType(user.id);
  const sessionDate = getSessionDate(bathTimeType);

  const { data: completed } = await supabaseAdmin
    .from('bath_logs')
    .select('id, done_at')
    .eq('user_id', user.id)
    .eq('session_date', sessionDate)
    .not('done_at', 'is', null)
    .limit(1)
    .single();

  if (completed) {
    return res.status(200).json({ phase: 'complete', done_at: completed.done_at });
  }

  return res.status(200).json({ phase: 'enter' });
};
