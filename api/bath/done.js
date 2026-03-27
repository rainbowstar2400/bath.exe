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

  // ユーザーの通知設定を取得
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('notify_time')
    .eq('user_id', user.id)
    .single();

  const notifyTime = sub?.notify_time || '23:00';

  // 現在のJST時刻と設定時刻を比較して褒め度合いを判定
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const [notifyH, notifyM] = notifyTime.split(':').map(Number);

  const currentMinutes = jstNow.getUTCHours() * 60 + jstNow.getUTCMinutes();
  const notifyMinutes = notifyH * 60 + notifyM;
  const diff = currentMinutes - notifyMinutes;

  let praiseLevel;
  let praisePrompt;

  if (diff < 0) {
    praiseLevel = 'excellent';
    praisePrompt = '設定時刻より早くお風呂に入った人を、めちゃくちゃ大げさに褒めて！天才！すごい！最高！のテンションで。2〜3文で。';
  } else if (diff <= 30) {
    praiseLevel = 'good';
    praisePrompt = 'お風呂に入った人を普通に褒めて！えらい！おつかれ！のテンションで。2〜3文で。';
  } else {
    praiseLevel = 'late';
    praisePrompt = '遅くなったけどお風呂に入った人を褒めて！「遅くても入っただけ偉い！」のテンションで。2〜3文で。';
  }

  // Claude APIで褒めメッセージを生成
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20241022',
    max_tokens: 200,
    system: 'あなたは「おふろの妖精」です。フランクで親しみやすい口調で、お風呂に入った人を全力で褒めます。',
    messages: [{ role: 'user', content: praisePrompt }],
  });

  const reply = response.content[0].text;

  // 入浴ログを記録
  await supabaseAdmin
    .from('bath_logs')
    .insert({
      user_id: user.id,
      notify_time: notifyTime,
      praise_level: praiseLevel,
    });

  return res.status(200).json({ reply, praise_level: praiseLevel });
};
