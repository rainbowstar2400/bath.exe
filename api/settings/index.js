const { supabaseAdmin, getUser } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUser(req);
  if (!user) {
    return res.status(401).json({ error: '認証が必要です' });
  }

  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('notify_time, enabled, bath_time_type')
    .eq('user_id', user.id)
    .single();

  if (error) {
    // レコードが無い場合はデフォルト値を返す
    return res.status(200).json({ notify_time: '23:00', enabled: true });
  }

  return res.status(200).json({
    notify_time: data.notify_time || '23:00',
    enabled: data.enabled !== false,
    bath_time_type: data.bath_time_type || 'night',
  });
};
