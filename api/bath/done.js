const Anthropic = require('@anthropic-ai/sdk');
const { supabaseAdmin, getUser } = require('../_lib/supabase');

const anthropic = new Anthropic();

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUser(req);
  if (!user) {
    return res.status(401).json({ error: '認証が必要です' });
  }

  const now = new Date();

  // done_atがnullの進行中レコードを検索（session_dateに依存しない）
  const { data: log } = await supabaseAdmin
    .from('bath_logs')
    .select('*')
    .eq('user_id', user.id)
    .is('done_at', null)
    .not('started_at', 'is', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  if (!log) {
    return res.status(404).json({ error: '入浴開始の記録がありません' });
  }

  if (log.done_at) {
    return res.status(409).json({ error: '本日は既に完了記録があります' });
  }

  // 褒め度合いを判定
  const notifyTime = log.notify_time || '23:00';
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const [notifyH, notifyM] = notifyTime.split(':').map(Number);
  const currentMinutes = jstNow.getUTCHours() * 60 + jstNow.getUTCMinutes();
  const notifyMinutes = notifyH * 60 + notifyM;

  const praiseLevel = currentMinutes < notifyMinutes ? 'excellent' : 'good';
  const praisePrompt = praiseLevel === 'excellent'
    ? '設定時刻より早くお風呂に入った人を、めちゃくちゃ大げさに褒めて！天才！すごい！最高！のテンションで。2〜3文で。'
    : 'お風呂に入った人を普通に褒めて！えらい！おつかれ！のテンションで。2〜3文で。';

  // done_atとpraise_levelを更新
  const { error: updateError } = await supabaseAdmin
    .from('bath_logs')
    .update({
      done_at: now.toISOString(),
      praise_level: praiseLevel,
    })
    .eq('id', log.id);

  if (updateError) {
    console.error('入浴完了記録エラー:', updateError.message);
    return res.status(500).json({ error: '入浴完了の記録に失敗しました' });
  }

  // Claude APIで褒めメッセージを生成
  let reply;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20241022',
      max_tokens: 200,
      system: 'あなたは「おふろの妖精」です。フランクで親しみやすい口調で、お風呂に入った人を全力で褒めます。',
      messages: [{ role: 'user', content: praisePrompt }],
    });
    reply = response.content[0].text;
  } catch (err) {
    console.error('Claude API エ��ー:', err.message);
    reply = 'おつかれさま！えらい！！🎉';
  }

  return res.status(200).json({ reply, praise_level: praiseLevel });
};
