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

  const bathTimeType = await getBathTimeType(user.id);
  const today = getSessionDate(bathTimeType);

  // 7日前の日付を算出
  const todayDate = new Date(today + 'T12:00:00+09:00');
  const weekAgo = new Date(todayDate);
  weekAgo.setDate(weekAgo.getDate() - 6);
  const weekStart = weekAgo.toISOString().split('T')[0];

  // 過去7日分の入浴ログを取得
  const { data: logs, error: logsError } = await supabaseAdmin
    .from('bath_logs')
    .select('*')
    .eq('user_id', user.id)
    .gte('session_date', weekStart)
    .lte('session_date', today)
    .order('session_date', { ascending: false });

  if (logsError) {
    return res.status(500).json({ error: '入浴ログの取得に失敗しました' });
  }

  // ユーザーの登録日を取得（グレーアウト判定用）
  const registeredAt = user.created_at;

  // 日別データを組み立て（今日から7日前まで、新しい順）
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];

    const log = (logs || []).find(l => l.session_date === dateStr);

    days.push({
      date: dateStr,
      started_at: log?.started_at || null,
      done_at: log?.done_at || null,
      praise_level: log?.praise_level || null,
      is_manual: log?.is_manual || false,
    });
  }

  // 連続記録を算出（今日から遡って連続で入浴した日数）
  // started_at または done_at があれば入浴とみなす（旧データ互換）
  const { data: allLogs, error: allLogsError } = await supabaseAdmin
    .from('bath_logs')
    .select('session_date')
    .eq('user_id', user.id)
    .or('started_at.not.is.null,done_at.not.is.null')
    .order('session_date', { ascending: false })
    .limit(90);

  if (allLogsError) {
    return res.status(500).json({ error: '連続記録の取得に失敗しました' });
  }

  const logDates = new Set((allLogs || []).map(l => l.session_date));
  let streak = 0;
  const checkDate = new Date(todayDate);
  for (let i = 0; i < 90; i++) {
    const dateStr = checkDate.toISOString().split('T')[0];
    if (logDates.has(dateStr)) {
      streak++;
    } else {
      // 今日まだ入ってない場合は、昨日からカウント開始
      if (i === 0) {
        checkDate.setDate(checkDate.getDate() - 1);
        continue;
      }
      break;
    }
    checkDate.setDate(checkDate.getDate() - 1);
  }

  return res.status(200).json({
    streak,
    registered_at: registeredAt,
    days,
  });
};
