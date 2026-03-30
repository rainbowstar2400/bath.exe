// Supabase匿名認証とAPI呼び出しのヘルパー

let SUPABASE_URL = '';
let SUPABASE_ANON_KEY = '';
let VAPID_PUBLIC_KEY = '';

let supabaseClient;
let session = null;

// 初期化
async function initApp() {
  // サーバーから公開設定を取得
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const config = await res.json();
      SUPABASE_URL = config.supabaseUrl;
      SUPABASE_ANON_KEY = config.supabaseAnonKey;
      VAPID_PUBLIC_KEY = config.vapidPublicKey;
    }
  } catch (err) {
    console.warn('設定の取得に失敗:', err);
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('Supabase未設定: ローカルモードで動作します');
    showMainScreen();
    startClock();
    if (!localStorage.getItem('onboarding_done')) {
      showOnboarding();
    }
    return;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // 既存セッションを確認
  const { data: { session: existingSession } } = await supabaseClient.auth.getSession();
  if (existingSession) {
    session = existingSession;
  } else {
    // 匿名認証
    const { data, error } = await supabaseClient.auth.signInAnonymously();
    if (error) {
      console.error('認証エラー:', error);
      return;
    }
    session = data.session;
  }

  // トークン自動更新（長時間利用時の401を防止）
  supabaseClient.auth.onAuthStateChange((event, newSession) => {
    if (newSession) {
      session = newSession;
    }
  });

  // Service Worker登録
  if ('serviceWorker' in navigator) {
    await navigator.serviceWorker.register('/sw.js');
  }

  // 画面初期化
  showMainScreen();
  loadChatHistory();
  startClock();

  // 初回起動時はオンボーディングを表示
  if (!localStorage.getItem('onboarding_done')) {
    showOnboarding();
  }
}

// 認証ヘッダー付きfetch
async function apiFetch(path, options = {}) {
  if (!session) {
    return { error: 'オンライン機能を使うにはSupabaseの設定が必要です' };
  }
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
    ...options.headers,
  };
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.error || `サーバーエラー (${res.status})` };
  }
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

  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    const subJson = subscription.toJSON();
    // localStorageの設定値も一緒に送る（通知未許可→後で許可のフローで設定が反映されるように）
    const notifyTime = localStorage.getItem('notify_time') || document.getElementById('notify-time')?.value || '23:00';
    const bathTimeType = localStorage.getItem('bath_time_type') || 'night';
    const result = await apiFetch('/api/subscriptions/register', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
        notify_time: notifyTime,
        bath_time_type: bathTimeType,
      }),
    });

    if (result.error) {
      console.error('サブスク登録エラー:', result.error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('プッシュ通知の登録に失敗:', err);
    return false;
  }
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

// --- 時計と見積もり ---

let clockInterval = null;

function getBathDuration() {
  return parseInt(localStorage.getItem('bath_duration') || '20', 10);
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function updateClock() {
  const now = new Date();
  const timeEl = document.getElementById('current-time');
  timeEl.textContent = '';
  timeEl.appendChild(document.createTextNode(formatTime(now)));
  const secSpan = document.createElement('span');
  secSpan.className = 'clock-sec';
  secSpan.textContent = `:${String(now.getSeconds()).padStart(2, '0')}`;
  timeEl.appendChild(secSpan);

  if (bathPhase === 'enter') {
    const est = new Date(now.getTime() + getBathDuration() * 60 * 1000);
    document.getElementById('estimate-msg').textContent = `今入れば ${formatTime(est)} には出れるよ！`;
  }
  // 他のフェーズではbathEnter/bathDoneで直接更新する
}

function startClock() {
  if (clockInterval) clearInterval(clockInterval);
  updateClock();
  clockInterval = setInterval(updateClock, 1000);
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
  const chatArea = document.getElementById('chat-area');
  chatArea.innerHTML = '';

  try {
    const data = await apiFetch('/api/chat');
    if (data.error || !data.messages) return;

    for (const msg of data.messages) {
      appendMessage(msg.role, msg.content);
    }

    if (typeof data.remaining === 'number') {
      updateRemaining(data.remaining);
    }
    if (data.limited) {
      disableChat();
    }
  } catch (err) {
    console.error('チャット履歴の取得に失敗:', err);
  }
}

async function sendMessage() {
  const input = document.getElementById('message-input');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  appendMessage('user', message);
  setLoading(true);

  let chatLimited = false;
  try {
    const data = await apiFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    });

    if (data.error) {
      appendMessage('assistant', 'エラーが発生しました');
      return;
    }

    appendMessage('assistant', data.reply);
    if (typeof data.remaining === 'number') {
      updateRemaining(data.remaining);
    }

    if (data.limited) {
      disableChat();
      chatLimited = true;
    }
  } catch (err) {
    console.error('送信エラー:', err);
    appendMessage('assistant', '通信エラーが発生しました');
  } finally {
    if (!chatLimited) setLoading(false);
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

  // 入浴開始をサーバーに記録
  try {
    const data = await apiFetch('/api/bath/start', { method: 'POST' });
    if (data.error) {
      appendMessage('assistant', '記録に失敗しました…もう一度試してみて！', { action: true });
      btn.disabled = false;
      return;
    }
  } catch (err) {
    console.error('入浴開始記録エラー:', err);
    appendMessage('assistant', '通信エラーが発生しました…もう一度試してみて！', { action: true });
    btn.disabled = false;
    return;
  }

  appendMessage('assistant', 'いいぞいいぞ！いってらっしゃい！🚿', { action: true });

  // 見積もりメッセージを更新
  const est = new Date(Date.now() + getBathDuration() * 60 * 1000);
  document.getElementById('estimate-msg').textContent = `${formatTime(est)} くらいには出れるね！`;

  // フェーズを「はいった！」に切り替え
  bathPhase = 'done';
  btn.classList.add('phase-done');
  document.getElementById('bath-btn-label').textContent = 'はいった！';
  btn.disabled = false;
}

// 「はいった！」を押した時
async function bathDone() {
  const btn = document.getElementById('bath-btn');
  btn.disabled = true;

  // 押下時刻を記録（API応答前に取得）
  const doneTime = new Date();

  appendMessage('user', 'はいった！', { action: true });

  try {
    const data = await apiFetch('/api/bath/done', { method: 'POST' });

    if (data.error) {
      appendMessage('assistant', 'エラーが発生しました。もう一度試してみて！', { action: true });
      btn.disabled = false;
      return;
    }

    appendMessage('assistant', data.reply, { action: true });
  } catch (err) {
    console.error('入浴記録エラー:', err);
    appendMessage('assistant', '通信エラーが発生しました。もう一度試してみて！', { action: true });
    btn.disabled = false;
    return;
  }

  // 見積もりメッセージを更新（押下時刻を使用）
  document.getElementById('estimate-msg').textContent = `今日は ${formatTime(doneTime)} に入れました！`;

  // 完了状態に（成功時のみ）
  bathPhase = 'complete';
  btn.classList.remove('phase-done');
  btn.classList.add('phase-complete');
  document.getElementById('bath-btn-label').textContent = 'おつかれ！';
  btn.disabled = true;
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

  // お風呂の時間をlocalStorageから読み込み
  document.getElementById('bath-duration').value = getBathDuration();

  // お風呂のタイミングをlocalStorageから読み込み
  const bathTimeType = localStorage.getItem('bath_time_type') || 'night';
  const bathTimeTypeSelect = document.getElementById('bath-time-type');
  bathTimeTypeSelect.value = bathTimeType;
  updateBathTimeTypeTips(bathTimeType);
  bathTimeTypeSelect.onchange = () => updateBathTimeTypeTips(bathTimeTypeSelect.value);

  // サーバーから通知設定を取得
  try {
    const data = await apiFetch('/api/settings');
    if (!data.error) {
      document.getElementById('notify-time').value = data.notify_time;
      document.getElementById('notify-toggle').checked = data.enabled;
      if (data.bath_time_type) {
        document.getElementById('bath-time-type').value = data.bath_time_type;
        localStorage.setItem('bath_time_type', data.bath_time_type);
        updateBathTimeTypeTips(data.bath_time_type);
      }
    }
  } catch (err) {
    console.error('設定の取得に失敗:', err);
  }
}

function updateBathTimeTypeTips(type) {
  const tips = document.getElementById('bath-time-type-tips');
  if (type === 'morning') {
    tips.textContent = '💡 朝4時以降の入浴はその日の記録になります';
  } else {
    tips.innerHTML = '💡 深夜0時を過ぎても<br>正午までの入浴は前日の記録になります';
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
  const bathDuration = document.getElementById('bath-duration').value;
  const bathTimeType = document.getElementById('bath-time-type').value;

  // ローカル設定を保存
  localStorage.setItem('notify_time', notifyTime);
  localStorage.setItem('bath_duration', bathDuration);
  localStorage.setItem('bath_time_type', bathTimeType);

  if (session) {
    const result = await apiFetch('/api/settings/update', {
      method: 'POST',
      body: JSON.stringify({ notify_time: notifyTime, enabled, bath_time_type: bathTimeType }),
    });
    if (result.error) {
      alert('設定の保存に失敗しました: ' + result.error);
      return;
    }
  }

  // 見積もりメッセージを即時反映
  updateClock();

  alert('設定を保存しました');
}

// --- 記録画面 ---

async function loadStats() {
  const summaryEl = document.getElementById('stats-summary');
  const listEl = document.getElementById('stats-days');

  let data;
  try {
    data = await apiFetch('/api/stats');
  } catch (err) {
    console.error('記録取得エラー:', err);
    data = { error: true };
  }

  if (data.error) {
    summaryEl.textContent = 'データの取得に失敗しました';
    listEl.innerHTML = '';
    return;
  }

  // サマリー行
  const bathDays = data.days.filter(d => d.started_at || d.done_at).length;
  summaryEl.textContent = '';
  const streakSpan = document.createElement('span');
  streakSpan.className = 'stats-streak';
  streakSpan.textContent = `🔥 ${data.streak}日連続`;
  const countSpan = document.createElement('span');
  countSpan.className = 'stats-count';
  countSpan.textContent = `${bathDays}/7日入浴`;
  summaryEl.appendChild(streakSpan);
  summaryEl.appendChild(countSpan);

  // 登録日（グレーアウト判定用）
  const registeredDate = data.registered_at
    ? new Date(data.registered_at).toISOString().split('T')[0]
    : null;

  // 日別カード
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  listEl.innerHTML = '';

  for (const day of data.days) {
    const d = new Date(day.date + 'T00:00:00+09:00');
    const month = d.getMonth() + 1;
    const date = d.getDate();
    const dayName = dayNames[d.getDay()];

    const card = document.createElement('div');
    card.className = 'day-card';

    // アプリ使用開始前はグレーアウト
    if (registeredDate && day.date < registeredDate) {
      card.classList.add('grayed-out');
      const header = document.createElement('div');
      header.className = 'day-card-header';
      header.textContent = `${month}/${date}(${dayName})`;
      card.appendChild(header);
      listEl.appendChild(card);
      continue;
    }

    const hasBath = day.started_at || day.done_at;

    // ヘッダー行（日付 + マーク）
    const header = document.createElement('div');
    header.className = 'day-card-header';
    const dateText = document.createElement('span');
    dateText.textContent = `${month}/${date}(${dayName})`;
    header.appendChild(dateText);

    if (!hasBath) {
      const mark = document.createElement('span');
      mark.className = 'day-card-mark miss';
      mark.textContent = '❌';
      header.appendChild(mark);
    } else if (day.praise_level === 'excellent') {
      const mark = document.createElement('span');
      mark.className = 'day-card-mark excellent';
      mark.textContent = '⭐ 早い！';
      header.appendChild(mark);
    }
    card.appendChild(header);

    if (hasBath) {
      const detail = document.createElement('div');
      detail.className = 'day-card-detail';

      const startedTime = formatJstTime(day.started_at, day.date);
      const bathDuration = getBathDuration();

      // done_atがない場合は推測値を計算
      let doneTime;
      let isEstimated = false;
      if (day.done_at) {
        doneTime = formatJstTime(day.done_at, day.date);
      } else if (day.started_at) {
        const est = new Date(new Date(day.started_at).getTime() + bathDuration * 60 * 1000);
        doneTime = formatJstTime(est.toISOString(), day.date);
        isEstimated = true;
      }

      const timeLine = document.createElement('div');
      timeLine.className = 'day-card-times';

      // 入 バッジ
      const inBadge = document.createElement('span');
      inBadge.className = 'time-badge';
      inBadge.textContent = '入';
      timeLine.appendChild(inBadge);
      const inTime = document.createElement('span');
      inTime.className = 'time-value';
      inTime.textContent = startedTime || '--:--';
      timeLine.appendChild(inTime);

      // 出 バッジ
      const outBadge = document.createElement('span');
      outBadge.className = 'time-badge';
      outBadge.textContent = '出';
      timeLine.appendChild(outBadge);
      const outTime = document.createElement('span');
      outTime.className = 'time-value';
      outTime.textContent = doneTime || '--:--';
      timeLine.appendChild(outTime);

      // かかった時間
      if (day.started_at && (day.done_at || isEstimated)) {
        const start = new Date(day.started_at);
        const end = day.done_at
          ? new Date(day.done_at)
          : new Date(start.getTime() + bathDuration * 60 * 1000);
        const mins = Math.round((end - start) / 60000);
        const durationSpan = document.createElement('span');
        durationSpan.className = 'day-card-duration';
        durationSpan.textContent = `かかった時間：${mins}分`;
        if (isEstimated) {
          durationSpan.textContent += '（推測）';
        }
        timeLine.appendChild(durationSpan);
      }

      if (isEstimated) {
        const estLabel = document.createElement('span');
        estLabel.className = 'estimated-label';
        estLabel.textContent = '推測';
        timeLine.appendChild(estLabel);
      }
      detail.appendChild(timeLine);

      card.appendChild(detail);
    }

    // タップで編集
    card.addEventListener('click', () => openEditModal(day));
    card.style.cursor = 'pointer';
    listEl.appendChild(card);
  }
}

// タイムスタンプをJSTのHH:MM形式に変換
// sessionDateを渡すと、翌日にまたがる場合に「（翌）」を付与
function formatJstTime(isoString, sessionDate) {
  if (!isoString) return null;
  const d = new Date(isoString);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const timeStr = `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
  if (sessionDate) {
    const jstDateStr = jst.toISOString().split('T')[0];
    if (jstDateStr !== sessionDate) {
      return `（翌）${timeStr}`;
    }
  }
  return timeStr;
}

// --- 編集モーダル ---

function openEditModal(day) {
  const overlay = document.getElementById('edit-overlay');
  const dateLabel = document.getElementById('edit-date-label');
  const startedInput = document.getElementById('edit-started');
  const doneInput = document.getElementById('edit-done');

  const d = new Date(day.date + 'T00:00:00+09:00');
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const month = d.getMonth() + 1;
  const date = d.getDate();
  const dayName = dayNames[d.getDay()];
  dateLabel.textContent = `${month}/${date}(${dayName})`;

  // 既存値をセット
  startedInput.value = formatJstTime(day.started_at) || '';
  doneInput.value = formatJstTime(day.done_at) || '';

  // 編集対象の日付を保持
  overlay.dataset.editDate = day.date;

  overlay.style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('edit-overlay').style.display = 'none';
}

async function saveEdit() {
  const overlay = document.getElementById('edit-overlay');
  const date = overlay.dataset.editDate;
  const startedTime = document.getElementById('edit-started').value;
  const doneTime = document.getElementById('edit-done').value;

  // 時刻をISO文字列に変換
  // 境界時刻より前の時刻は翌日の日付に属する
  const bathTimeType = localStorage.getItem('bath_time_type') || 'night';
  const boundary = bathTimeType === 'morning' ? 4 : 12;
  function timeToIso(sessionDate, timeStr) {
    if (!timeStr) return null;
    const [h] = timeStr.split(':').map(Number);
    if (h < boundary) {
      // 翌日の日付を算出（toISOStringはUTCに戻るため文字列操作で算出）
      const d = new Date(sessionDate + 'T12:00:00+09:00');
      d.setDate(d.getDate() + 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}T${timeStr}:00+09:00`;
    }
    return `${sessionDate}T${timeStr}:00+09:00`;
  }
  const startedAt = timeToIso(date, startedTime);
  const doneAt = timeToIso(date, doneTime);

  const saveBtn = document.getElementById('edit-save-btn');
  saveBtn.disabled = true;

  try {
    const data = await apiFetch('/api/bath/edit', {
      method: 'POST',
      body: JSON.stringify({ date, started_at: startedAt, done_at: doneAt }),
    });

    if (data.error) {
      alert(data.error);
      return;
    }

    closeEditModal();
    await loadStats();
  } catch (err) {
    console.error('編集保存エラー:', err);
    alert('保存に失敗しました');
  } finally {
    saveBtn.disabled = false;
  }
}

// --- オンボーディング ---

let onboardingStep = 1;

function showOnboarding() {
  onboardingStep = 1;
  document.getElementById('onboarding-overlay').style.display = 'flex';
  updateOnboardingStep();
}

function updateOnboardingStep() {
  const steps = document.querySelectorAll('.onboarding-step');
  steps.forEach(s => {
    s.style.display = s.dataset.step === String(onboardingStep) ? 'block' : 'none';
  });

  const dots = document.querySelectorAll('.onboarding-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i < onboardingStep);
  });
}

function onboardingNext() {
  onboardingStep++;
  updateOnboardingStep();
}

async function onboardingPermission() {
  const success = await subscribePush();
  if (success) {
    document.getElementById('perm-btn').style.display = 'none';
  }
  onboardingNext();
}

async function onboardingComplete() {
  // 設定を保存
  const notifyTime = document.getElementById('ob-notify-time').value;
  const bathDuration = document.getElementById('ob-bath-duration').value;

  localStorage.setItem('notify_time', notifyTime);
  localStorage.setItem('bath_duration', bathDuration);
  localStorage.setItem('onboarding_done', '1');

  // サーバーに通知時刻を保存
  if (session) {
    await apiFetch('/api/settings/update', {
      method: 'POST',
      body: JSON.stringify({ notify_time: notifyTime, enabled: true }),
    });
  }

  // オーバーレイを閉じる
  document.getElementById('onboarding-overlay').style.display = 'none';

  // 時計を即時更新
  updateClock();
}

// --- 起動 ---
document.addEventListener('DOMContentLoaded', initApp);
