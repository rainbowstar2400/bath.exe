const { supabaseAdmin, getUser } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUser(req);
  if (!user) {
    return res.status(401).json({ error: '認証が必要です' });
  }

  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.auth || !keys?.p256dh) {
    return res.status(400).json({ error: 'endpoint と keys が必要です' });
  }

  const { error } = await supabaseAdmin
    .from('subscriptions')
    .upsert({
      user_id: user.id,
      endpoint,
      auth: keys.auth,
      p256dh: keys.p256dh,
    }, { onConflict: 'user_id' });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ ok: true });
};
