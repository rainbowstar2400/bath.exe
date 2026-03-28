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

  const { data, error } = await supabaseAdmin
    .from('chat_sessions')
    .upsert(
      { user_id: userId, session_date: sessionDate, messages: [] },
      { onConflict: 'user_id,session_date', ignoreDuplicates: true }
    )
    .select()
    .single();

  if (error) throw error;

  // upsertがignoreDuplicatesで行を返さない場合、既存を取得
  if (!data) {
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('chat_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('session_date', sessionDate)
      .single();

    if (fetchError) throw fetchError;
    return existing;
  }

  return data;
}

module.exports = { getSessionDate, getOrCreateSession };
