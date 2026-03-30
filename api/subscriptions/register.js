const { supabaseAdmin, getUser } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUser(req);
  if (!user) {
    return res.status(401).json({ error: '認証が必要です' });
  }

  const { endpoint, keys, notify_time, bath_time_type } = req.body;
  if (!endpoint || !keys?.auth || !keys?.p256dh) {
    return res.status(400).json({ error: 'endpoint と keys が必要です' });
  }

  const row = {
    user_id: user.id,
    endpoint,
    auth: keys.auth,
    p256dh: keys.p256dh,
  };
  // フロントから設定値が渡された場合は一緒に保存
  if (notify_time) row.notify_time = notify_time;
  if (bath_time_type) row.bath_time_type = bath_time_type;

  const { error } = await supabaseAdmin
    .from('subscriptions')
    .upsert(row, { onConflict: 'user_id' });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ ok: true });
};
