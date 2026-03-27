const { createClient } = require('@supabase/supabase-js');

// サービスロールキーでの管理用クライアント
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// リクエストのAuthorizationヘッダーからユーザーを取得
async function getUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error) return null;
  return user;
}

module.exports = { supabaseAdmin, getUser };
