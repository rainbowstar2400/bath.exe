const { supabaseAdmin } = require('./supabase');

// 正午（12:00 JST）を日付の境界としたセッション日付を取得
function getSessionDate() {
  const now = new Date();
  // JST（UTC+9）での現在時刻を計算
  const jstHours = (now.getUTCHours() + 9) % 24;
  const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);

  // 正午より前なら前日をセッション日付とする
  if (jstHours < 12) {
    jstDate.setDate(jstDate.getDate() - 1);
  }

  return jstDate.toISOString().split('T')[0];
}

// 当日のセッションを取得（なければ新規作成）
// upsertで競合を防ぐ
async function getOrCreateSession(userId) {
  const sessionDate = getSessionDate();

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

module.exports = { getSessionDate, getOrCreateSession };
