const { supabaseAdmin, getUser } = require('../_lib/supabase');
const { getSessionDate } = require('../_lib/session');

// 入浴ログのdone_atからセッション日付を算出（正午境界）
function logToSessionDate(doneAt) {
  const logDate = new Date(doneAt);
  const logJst = new Date(logDate.getTime() + 9 * 60 * 60 * 1000);
  const jstHours = logJst.getUTCHours();
  if (jstHours < 12) {
    logJst.setDate(logJst.getDate() - 1);
  }
  return logJst.toISOString().split('T')[0];
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUser(req);
  if (!user) {
    return res.status(401).json({ error: '認証が必要です' });
  }

  // 直近7日分の入浴ログを取得
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = jstNow.toISOString().split('T')[0];

  // 今週の月曜日を算出
  const dayOfWeek = jstNow.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(jstNow);
  monday.setDate(monday.getDate() - mondayOffset);
  const weekStart = monday.toISOString().split('T')[0];

  const { data: logs, error: logsError } = await supabaseAdmin
    .from('bath_logs')
    .select('*')
    .eq('user_id', user.id)
    .gte('done_at', `${weekStart}T03:00:00+00:00`)
    .order('done_at', { ascending: true });

  if (logsError) {
    return res.status(500).json({ error: '入浴ログの取得に失敗しました' });
  }

  // 今週の日ごとのデータを組み立て
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];

    // その日は未来か？
    if (dateStr > today) break;

    const log = (logs || []).find(l => logToSessionDate(l.done_at) === dateStr);

    days.push({
      date: dateStr,
      done_at: log?.done_at || null,
      praise_level: log?.praise_level || null,
    });
  }

  const doneDays = days.filter(d => d.done_at);
  const rate = days.length > 0 ? doneDays.length / days.length : 0;

  // 連続記録を算出（今日から遡って連続で入浴した日数）
  const { data: allLogs, error: allLogsError } = await supabaseAdmin
    .from('bath_logs')
    .select('done_at')
    .eq('user_id', user.id)
    .order('done_at', { ascending: false })
    .limit(90);

  if (allLogsError) {
    return res.status(500).json({ error: '連続記録の取得に失敗しました' });
  }

  let streak = 0;
  const checkDate = new Date(jstNow);
  for (let i = 0; i < 90; i++) {
    const dateStr = checkDate.toISOString().split('T')[0];
    const found = (allLogs || []).some(l => logToSessionDate(l.done_at) === dateStr);
    if (found) {
      streak++;
    } else {
      // 今日まだ入ってない場合は、昨日まで数える
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
    weekly: { rate: Math.round(rate * 100) / 100, days },
  });
};
