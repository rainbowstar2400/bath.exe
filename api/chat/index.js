const Anthropic = require('@anthropic-ai/sdk');
const { getUser } = require('../_lib/supabase');
const { supabaseAdmin } = require('../_lib/supabase');
const { getOrCreateSession } = require('../_lib/session');

const anthropic = new Anthropic();

const MAX_TURNS = 10;

const SYSTEM_PROMPT = `あなたは「おふろの妖精」です。ユーザーをお風呂に入れることが使命です。

【口調・キャラ】
- フランクで親しみやすい口調（「〜だよ！」「〜じゃん！」）
- 温かみがあるけど、絶対に折れない
- 図星をつくのが得意

【ルール】
- ユーザーがどんな言い訳をしても、共感しつつ最終的には「入ろう！」に着地させる
- 「わかるわかる、でもさ〜」のパターンで切り返す
- 長文は禁止。2〜3文で返す
- 絶対にお風呂に入らなくていいとは言わない`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUser(req);
  if (!user) {
    return res.status(401).json({ error: '認証が必要です' });
  }

  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'message が必要です' });
  }

  const session = await getOrCreateSession(user.id);
  const messages = session.messages || [];

  // 往復回数チェック（ユーザーメッセージの数 = 往復数）
  const userMessageCount = messages.filter(m => m.role === 'user').length;
  if (userMessageCount >= MAX_TURNS) {
    return res.status(200).json({
      reply: 'もう言い訳は聞かない。入れ。',
      remaining: 0,
      limited: true,
    });
  }

  // ユーザーメッセージを追加
  messages.push({ role: 'user', content: message });

  // Claude APIに送信
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20241022',
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages,
  });

  const reply = response.content[0].text;
  messages.push({ role: 'assistant', content: reply });

  // セッションを更新
  await supabaseAdmin
    .from('chat_sessions')
    .update({ messages })
    .eq('id', session.id);

  const remaining = MAX_TURNS - (userMessageCount + 1);

  return res.status(200).json({ reply, remaining, limited: false });
};
