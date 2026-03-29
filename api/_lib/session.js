const { supabaseAdmin } = require('./supabase');

// 境界時刻に基づいたセッション日付を取得
// bathTimeType: 'night'（境界=正午12:00）, 'morning'（境界=早朝4:00）
function getSessionDate(bathTimeType = 'night') {
  const boundary = bathTimeType === 'morning' ? 4 : 12;
  const now = new Date();
  // JST（UTC+9）での現在時刻を計算
  const jstHours = (now.getUTCHours() + 9) % 24;
  const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);

  // 境界時刻より前なら前日をセッション日付とする
  if (jstHours < boundary) {
    jstDate.setDate(jstDate.getDate() - 1);
  }

  return jstDate.toISOString().split('T')[0];
}

// ユーザーのbath_time_type設定を取得
async function getBathTimeType(userId) {
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('bath_time_type')
    .eq('user_id', userId)
    .single();
  return (data && data.bath_time_type) || 'night';
}

// 当日のセッションを取得（なければ新規作成）
// upsertで競合を防ぐ
async function getOrCreateSession(userId) {
  const bathTimeType = await getBathTimeType(userId);
  const sessionDate = getSessionDate(bathTimeType);

  // まず既存セッションを取得
  const { data: existing } = await supabaseAdmin
    .from('chat_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('session_date', sessionDate)
    .single();

  if (existing) return existing;

  // なければ新規作成
  const { data, error } = await supabaseAdmin
    .from('chat_sessions')
    .insert({ user_id: userId, session_date: sessionDate, messages: [] })
    .select()
    .single();

  if (error) {
    // 競合が発生した場合（別リクエストが先に作成）は再取得
    if (error.code === '23505') {
      const { data: retry, error: retryError } = await supabaseAdmin
        .from('chat_sessions')
        .select('*')
        .eq('user_id', userId)
        .eq('session_date', sessionDate)
        .single();
      if (retryError) throw retryError;
      return retry;
    }
    throw error;
  }

  return data;
}

module.exports = { getSessionDate, getOrCreateSession, getBathTimeType };
