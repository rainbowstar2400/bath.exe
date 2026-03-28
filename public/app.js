// Supabase匿名認証とAPI呼び出しのヘルパー

const SUPABASE_URL = '';  // デプロイ時に設定
const SUPABASE_ANON_KEY = '';  // デプロイ時に設定
const VAPID_PUBLIC_KEY = '';  // デプロイ時に設定

let supabase;
let session = null;

// 初期化
async function initApp() {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // 既存セッションを確認
  const { data: { session: existingSession } } = await supabase.auth.getSession();
  if (existingSession) {
    session = existingSession;
  } else {
    // 匿名認証
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.error('認証エラー:', error);
      return;
    }
    session = data.session;
  }

  // Service Worker登録
  if ('serviceWorker' in navigator) {
    await navigator.serviceWorker.register('/sw.js');
  }

  // 画面初期化
  showMainScreen();
  loadChatHistory();
}

// 認証ヘッダー付きfetch
async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
    ...options.headers,
  };
  const res = await fetch(path, { ...options, headers });
  return res.json();
}

// プッシュ通知のサブスクリプション登録
async function subscribePush() {
  if (!('PushManager' in window)) {
    alert('このブラウザはプッシュ通知に対応していません');
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return false;
  }

  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  const subJson = subscription.toJSON();
  await apiFetch('/api/subscriptions/register', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: subJson.endpoint,
      keys: subJson.keys,
    }),
  });

  return true;
}

// VAPID公開鍵の変換
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// --- 画面制御 ---

function showMainScreen() {
  document.getElementById('main-screen').style.display = 'flex';
  document.getElementById('settings-screen').style.display = 'none';
  document.getElementById('stats-screen').style.display = 'none';
}

function showSettingsScreen() {
  document.getElementById('main-screen').style.display = 'none';
  document.getElementById('settings-screen').style.display = 'flex';
  document.getElementById('stats-screen').style.display = 'none';
  loadSettings();
}

async function showStatsScreen() {
  document.getElementById('main-screen').style.display = 'none';
  document.getElementById('settings-screen').style.display = 'none';
  document.getElementById('stats-screen').style.display = 'flex';
  await loadStats();
}

// --- チャット ---

async function loadChatHistory() {
  // 初回はチャットエリアを空にしておく（セッションはサーバー側で管理）
  const chatArea = document.getElementById('chat-area');
  chatArea.innerHTML = '';
}

async function sendMessage() {
  const input = document.getElementById('message-input');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  appendMessage('user', message);
  setLoading(true);

  const data = await apiFetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });

  setLoading(false);

  if (data.error) {
    appendMessage('assistant', 'エラーが発生しました');
    return;
  }

  appendMessage('assistant', data.reply);
  updateRemaining(data.remaining);

  if (data.limited) {
    disableChat();
  }
}

function appendMessage(role, text, options = {}) {
  const chatArea = document.getElementById('chat-area');
  const wrap = document.createElement('div');
  wrap.className = `message-wrap ${role}`;

  const div = document.createElement('div');
  div.className = `message ${role}`;
  if (options.action) div.classList.add('action');
  div.textContent = text;
  wrap.appendChild(div);

  // 時刻表示
  const time = document.createElement('span');
  time.className = 'message-time';
  const now = new Date();
  time.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  wrap.appendChild(time);

  chatArea.appendChild(wrap);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function updateRemaining(count) {
  document.getElementById('remaining').textContent = `残り ${count}/10`;
}

function disableChat() {
  document.getElementById('message-input').disabled = true;
  document.getElementById('send-btn').disabled = true;
}

function setLoading(loading) {
  document.getElementById('send-btn').disabled = loading;
  document.getElementById('message-input').disabled = loading;
}

// --- メインアクションボタン（2段階） ---
// phase: 'enter' → 'done' → 'complete'

let bathPhase = 'enter';

function handleBathAction() {
  if (bathPhase === 'enter') {
    bathEnter();
  } else if (bathPhase === 'done') {
    bathDone();
  }
}

// 「今はいる！」を押した時
async function bathEnter() {
  const btn = document.getElementById('bath-btn');
  btn.disabled = true;

  appendMessage('user', '今はいる！', { action: true });
  appendMessage('assistant', 'いいぞいいぞ！いってらっしゃい！🚿', { action: true });

  // フェーズを「はいった！」に切り替え
  bathPhase = 'done';
  btn.classList.add('phase-done');
  document.getElementById('bath-btn-label').textContent = 'はいった！';
  document.getElementById('bath-btn-sub').textContent = 'お風呂から出たらタップ';
  btn.disabled = false;
}

// 「はいった！」を押した時
async function bathDone() {
  const btn = document.getElementById('bath-btn');
  btn.disabled = true;

  appendMessage('user', 'はいった！', { action: true });

  const data = await apiFetch('/api/bath/done', { method: 'POST' });

  if (data.error) {
    btn.disabled = false;
    return;
  }

  appendMessage('assistant', data.reply, { action: true });

  // 完了状態に
  bathPhase = 'complete';
  btn.classList.remove('phase-done');
  btn.classList.add('phase-complete');
  document.getElementById('bath-btn-label').textContent = 'おつかれ！';
  document.getElementById('bath-btn-sub').textContent = 'きょうのお風呂クリア 🎉';
}

// --- 設定画面 ---

async function loadSettings() {
  // 現在の通知許可状態を表示
  const permBtn = document.getElementById('perm-btn');
  if (Notification.permission === 'granted') {
    permBtn.style.display = 'none';
  } else {
    permBtn.style.display = 'block';
  }
}

async function requestPermission() {
  const success = await subscribePush();
  if (success) {
    document.getElementById('perm-btn').style.display = 'none';
    alert('通知を許可しました！');
  }
}

async function saveSettings() {
  const notifyTime = document.getElementById('notify-time').value;
  const enabled = document.getElementById('notify-toggle').checked;

  await apiFetch('/api/settings/update', {
    method: 'POST',
    body: JSON.stringify({ notify_time: notifyTime, enabled }),
  });

  alert('設定を保存しました');
}

// --- 統計画面 ---

async function loadStats() {
  const data = await apiFetch('/api/stats');

  if (data.error) {
    document.getElementById('stats-content').innerHTML = '<p>データの取得に失敗しました</p>';
    return;
  }

  const streakEl = document.getElementById('streak');
  streakEl.textContent = `🔥 連続記録：${data.streak}日`;

  const rateEl = document.getElementById('weekly-rate');
  const doneDays = data.weekly.days.filter(d => d.done_at).length;
  const totalDays = data.weekly.days.length;
  const percent = Math.round(data.weekly.rate * 100);
  rateEl.textContent = `今週の入浴率  ${doneDays}/${totalDays}  ${percent}%`;

  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const listEl = document.getElementById('weekly-days');
  listEl.innerHTML = '';
  for (const day of data.weekly.days) {
    const d = new Date(day.date + 'T00:00:00+09:00');
    const dayName = dayNames[d.getDay()];
    const li = document.createElement('li');

    if (day.done_at) {
      const time = new Date(day.done_at);
      const jst = new Date(time.getTime() + 9 * 60 * 60 * 1000);
      const h = String(jst.getUTCHours()).padStart(2, '0');
      const m = String(jst.getUTCMinutes()).padStart(2, '0');
      const mark = day.praise_level === 'excellent' ? ' ⭐ 早い！' :
                   day.praise_level === 'late' ? ' 😅 ギリギリ' : '';
      li.textContent = `${dayName}  ${h}:${m}${mark}`;
    } else {
      li.textContent = `${dayName}  --:--  ❌`;
    }

    listEl.appendChild(li);
  }
}

// --- 起動 ---
document.addEventListener('DOMContentLoaded', initApp);
