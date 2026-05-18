/**
 * script.js — AquaCare
 * Семья и localStorage, приглашение по QR (qrcodejs CDN), лента событий,
 * двухшаговое меню обслуживания, обработчики UI.
 *
 * Дополнительно: сохранение ленты между сеансами, безопасная разметка записей
 * (без innerHTML для пользовательских строк), закрытие модалок по Escape,
 * возврат фокуса и цикл Tab внутри диалога, сообщение если QR-библиотека не загрузилась.
 */

const FAMILY_STORAGE_KEY = 'aquacare_family_v1';
const FEED_STORAGE_KEY = 'aquacare_feed_v1';
const TEMP_STORAGE_KEY = 'aquacare_temp_v1';
const LIGHT_STORAGE_KEY = 'aquacare_light_v1';
const MAX_FEED_ITEMS = 40;

const FEED_DEFAULT = [
    { user: 'Система', action: 'Свет включен', time: '08:00' },
    { user: 'Мама', action: 'Покормила рыб', time: 'Вчера 19:20' }
];

const MAINT_SCHEDULES = {
    monthly: {
        label: 'Ежемесячно',
        tasks: ['Чистка фильтра']
    },
    weekly: {
        label: 'Еженедельно',
        tasks: ['Подмена воды', 'Чистка стекол', 'Сифонка грунта']
    },
    daily: {
        label: 'Ежедневно',
        tasks: ['Кормление', 'Проверка работоспособности оборудования']
    }
};

const FOCUSABLE_SEL = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

let maintStep = 1;
let maintScheduleKey = null;
let qrInstance = null;

/** @type {{ type: string, root: HTMLElement } | null} */
let activeModalDialog = null;
let lastFocusBeforeModal = null;

/** @type {Array<{ user: string, action: string, time: string }>} */
let feedEntries = [];

function getFocusableIn(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE_SEL)).filter((el) => {
        if (el.disabled) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        return el.offsetParent !== null || el === document.activeElement;
    });
}

function loadFeedEntries() {
    try {
        const raw = localStorage.getItem(FEED_STORAGE_KEY);
        if (!raw) return FEED_DEFAULT.map((e) => ({ ...e }));
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr) || !arr.length) return FEED_DEFAULT.map((e) => ({ ...e }));
        return arr
            .filter((e) => e && typeof e.user === 'string' && typeof e.action === 'string' && typeof e.time === 'string')
            .slice(0, MAX_FEED_ITEMS);
    } catch (e) {
        return FEED_DEFAULT.map((entry) => ({ ...entry }));
    }
}

function saveFeedEntries() {
    try {
        localStorage.setItem(FEED_STORAGE_KEY, JSON.stringify(feedEntries.slice(0, MAX_FEED_ITEMS)));
    } catch (e) { /* квота / приватный режим */ }
}

function buildFeedItemElement(entry) {
    const row = document.createElement('div');
    row.className = 'feed-item';
    const b = document.createElement('b');
    b.textContent = entry.user + ':';
    row.appendChild(b);
    row.appendChild(document.createTextNode(' ' + entry.action + ' (' + entry.time + ')'));
    return row;
}

function renderFeedFromEntries() {
    const feed = document.getElementById('activityFeed');
    feed.replaceChildren();
    feedEntries.forEach((entry) => {
        feed.appendChild(buildFeedItemElement(entry));
    });
}

function initFeed() {
    feedEntries = loadFeedEntries();
    renderFeedFromEntries();
}

function getFamily() {
    try {
        const raw = localStorage.getItem(FAMILY_STORAGE_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            if (Array.isArray(data) && data.length) return data;
        }
    } catch (e) { /* ignore */ }
    return ['Вы'];
}

function setFamily(names) {
    try {
        localStorage.setItem(FAMILY_STORAGE_KEY, JSON.stringify(names));
    } catch (e) { /* ignore */ }
}

function getInviteUrl() {
    const u = new URL(window.location.href);
    u.searchParams.set('join', '1');
    return u.href;
}

function renderFamilyUi() {
    const names = getFamily();
    const n = names.length;
    document.getElementById('familyCountLabel').textContent = 'Семья (' + n + ')';
    document.getElementById('familyListPreview').textContent = names.join(' · ');
}

function addFamilyMemberFromInvite() {
    const names = getFamily();
    names.push('Участник ' + (names.length + 1));
    setFamily(names);
    renderFamilyUi();
    addLog('Система', 'Новый участник добавлен по ссылке-приглашению');
}

function processJoinQuery() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('join') !== '1') return;
    addFamilyMemberFromInvite();
    params.delete('join');
    const qs = params.toString();
    const path = window.location.pathname + window.location.hash;
    history.replaceState({}, '', path + (qs ? '?' + qs : ''));
}

function setActiveModal(type, dialogRoot) {
    activeModalDialog = { type, root: dialogRoot };
}

function clearActiveModal() {
    activeModalDialog = null;
}

function openQrModal() {
    lastFocusBeforeModal = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = document.getElementById('qrModal');
    const host = document.getElementById('qrHost');
    host.innerHTML = '';
    host.classList.remove('qr-host-error');

    if (typeof QRCode === 'undefined') {
        host.classList.add('qr-host-error');
        host.textContent = 'Не удалось загрузить генератор QR. Проверьте подключение к сети и обновите страницу.';
    } else {
        const url = getInviteUrl();
        qrInstance = new QRCode(host, {
            text: url,
            width: 200,
            height: 200,
            colorDark: '#0f172a',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
    }

    const dialogRoot = modal.querySelector('.qr-card');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setActiveModal('qr', dialogRoot);
    requestAnimationFrame(() => {
        document.getElementById('qrClose').focus();
    });
}

function closeQrModal() {
    const modal = document.getElementById('qrModal');
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    document.getElementById('qrHost').innerHTML = '';
    document.getElementById('qrHost').classList.remove('qr-host-error');
    qrInstance = null;
    clearActiveModal();
    if (lastFocusBeforeModal && typeof lastFocusBeforeModal.focus === 'function') {
        lastFocusBeforeModal.focus();
    }
    lastFocusBeforeModal = null;
}

function addLog(user, action) {
    const now = new Date();
    const time = now.getHours() + ':' + (now.getMinutes() < 10 ? '0' : '') + now.getMinutes();
    const entry = { user, action, time };
    feedEntries.unshift(entry);
    if (feedEntries.length > MAX_FEED_ITEMS) feedEntries.length = MAX_FEED_ITEMS;

    const feed = document.getElementById('activityFeed');
    feed.insertBefore(buildFeedItemElement(entry), feed.firstChild);
    while (feed.children.length > MAX_FEED_ITEMS) {
        feed.removeChild(feed.lastChild);
    }
    saveFeedEntries();
}

function maintClearList() {
    document.getElementById('maintList').innerHTML = '';
}

function maintAppendOption(text, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'maint-option';
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    document.getElementById('maintList').appendChild(btn);
}

function openMaintModal() {
    lastFocusBeforeModal = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = document.getElementById('maintModal');
    const sheet = modal.querySelector('.maint-sheet');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    maintShowStep1();
    setActiveModal('maint', sheet);
    requestAnimationFrame(() => {
        document.querySelector('#maintList .maint-option')?.focus();
    });
}

function closeMaintModal() {
    const modal = document.getElementById('maintModal');
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    maintStep = 1;
    maintScheduleKey = null;
    clearActiveModal();
    if (lastFocusBeforeModal && typeof lastFocusBeforeModal.focus === 'function') {
        lastFocusBeforeModal.focus();
    }
    lastFocusBeforeModal = null;
}

function getStorageValue(key, defaultValue) {
    try {
        const raw = localStorage.getItem(key);
        return raw !== null ? JSON.parse(raw) : defaultValue;
    } catch (e) {
        return defaultValue;
    }
}

function setStorageValue(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* ignore */ }
}

function openTempModal() {
    lastFocusBeforeModal = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = document.getElementById('tempModal');
    const sheet = modal.querySelector('.maint-sheet');
    const targetTemp = getStorageValue(TEMP_STORAGE_KEY, 26);
    document.getElementById('tempSlider').value = targetTemp;
    document.getElementById('tempValue').textContent = targetTemp;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setActiveModal('temp', sheet);
    requestAnimationFrame(() => {
        document.getElementById('tempSlider').focus();
    });
}

function closeTempModal() {
    const modal = document.getElementById('tempModal');
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    clearActiveModal();
    if (lastFocusBeforeModal && typeof lastFocusBeforeModal.focus === 'function') {
        lastFocusBeforeModal.focus();
    }
    lastFocusBeforeModal = null;
}

function openLightModal() {
    lastFocusBeforeModal = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = document.getElementById('lightModal');
    const sheet = modal.querySelector('.maint-sheet');
    const lightState = getStorageValue(LIGHT_STORAGE_KEY, { enabled: true, brightness: 100 });
    document.getElementById('lightSlider').value = lightState.brightness;
    document.getElementById('lightValue').textContent = lightState.brightness;
    updateLightToggleButton(lightState.enabled);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setActiveModal('light', sheet);
    requestAnimationFrame(() => {
        document.getElementById('lightToggle').focus();
    });
}

function closeLightModal() {
    const modal = document.getElementById('lightModal');
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    clearActiveModal();
    if (lastFocusBeforeModal && typeof lastFocusBeforeModal.focus === 'function') {
        lastFocusBeforeModal.focus();
    }
    lastFocusBeforeModal = null;
}

function updateLightToggleButton(enabled) {
    const btn = document.getElementById('lightToggle');
    if (enabled) {
        btn.textContent = '💡 Свет: Включен';
        btn.classList.remove('off');
    } else {
        btn.textContent = '💡 Свет: Отключен';
        btn.classList.add('off');
    }
}

function openFeedModal() {
    lastFocusBeforeModal = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = document.getElementById('feedModal');
    const sheet = modal.querySelector('.maint-sheet');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setActiveModal('feed', sheet);
    requestAnimationFrame(() => {
        const firstOption = document.querySelector('#feedModal .feed-option');
        if (firstOption) firstOption.focus();
    });
}

function closeFeedModal() {
    const modal = document.getElementById('feedModal');
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    clearActiveModal();
    if (lastFocusBeforeModal && typeof lastFocusBeforeModal.focus === 'function') {
        lastFocusBeforeModal.focus();
    }
    lastFocusBeforeModal = null;
}

function maintShowStep1() {
    maintStep = 1;
    maintScheduleKey = null;
    document.getElementById('maintTitle').textContent = 'Обслуживание';
    document.getElementById('maintSubtitle').textContent = 'Выберите периодичность';
    document.getElementById('maintBack').disabled = true;
    maintClearList();
    Object.entries(MAINT_SCHEDULES).forEach(([key, cfg]) => {
        maintAppendOption(cfg.label, () => maintShowStep2(key));
    });
    if (activeModalDialog && activeModalDialog.type === 'maint') {
        requestAnimationFrame(() => {
            document.querySelector('#maintList .maint-option')?.focus();
        });
    }
}

function maintShowStep2(scheduleKey) {
    maintStep = 2;
    maintScheduleKey = scheduleKey;
    const cfg = MAINT_SCHEDULES[scheduleKey];
    document.getElementById('maintTitle').textContent = cfg.label;
    document.getElementById('maintSubtitle').textContent = 'Выберите вид работ';
    document.getElementById('maintBack').disabled = false;
    maintClearList();
    cfg.tasks.forEach((task) => {
        maintAppendOption(task, () => {
            addLog('Вы', 'Обслуживание (' + cfg.label + '): ' + task);
            closeMaintModal();
        });
    });
    requestAnimationFrame(() => {
        document.querySelector('#maintList .maint-option')?.focus();
    });
}

document.addEventListener('keydown', (e) => {
    if (!activeModalDialog) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        if (activeModalDialog.type === 'qr') closeQrModal();
        else if (activeModalDialog.type === 'maint') closeMaintModal();
        else if (activeModalDialog.type === 'temp') closeTempModal();
        else if (activeModalDialog.type === 'light') closeLightModal();
        else if (activeModalDialog.type === 'feed') closeFeedModal();
        return;
    }
    if (e.key !== 'Tab' || !activeModalDialog.root) return;
    const list = getFocusableIn(activeModalDialog.root);
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey) {
        if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
        }
    } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
});

initFeed();
processJoinQuery();
renderFamilyUi();

document.getElementById('btnQr').addEventListener('click', openQrModal);
document.getElementById('qrClose').addEventListener('click', closeQrModal);
document.getElementById('qrModal').addEventListener('click', (e) => {
    if (e.target.id === 'qrModal') closeQrModal();
});

document.getElementById('btnMaintenance').addEventListener('click', openMaintModal);
document.getElementById('maintBack').addEventListener('click', () => {
    if (maintStep === 2) maintShowStep1();
});
document.getElementById('maintClose').addEventListener('click', closeMaintModal);
document.getElementById('maintModal').addEventListener('click', (e) => {
    if (e.target.id === 'maintModal') closeMaintModal();
});

document.getElementById('btnLight').addEventListener('click', openLightModal);
document.getElementById('lightClose').addEventListener('click', closeLightModal);
document.getElementById('lightModal').addEventListener('click', (e) => {
    if (e.target.id === 'lightModal') closeLightModal();
});

const lightToggleBtn = document.getElementById('lightToggle');
const lightSlider = document.getElementById('lightSlider');
lightToggleBtn.addEventListener('click', () => {
    const lightState = getStorageValue(LIGHT_STORAGE_KEY, { enabled: true, brightness: 100 });
    lightState.enabled = !lightState.enabled;
    setStorageValue(LIGHT_STORAGE_KEY, lightState);
    updateLightToggleButton(lightState.enabled);
    addLog('Вы', lightState.enabled ? 'Свет включен' : 'Свет отключен');
});

lightSlider.addEventListener('input', (e) => {
    const brightness = parseInt(e.target.value, 10);
    document.getElementById('lightValue').textContent = brightness;
    const lightState = getStorageValue(LIGHT_STORAGE_KEY, { enabled: true, brightness: 100 });
    lightState.brightness = brightness;
    setStorageValue(LIGHT_STORAGE_KEY, lightState);
});

document.getElementById('btnFeed').addEventListener('click', openFeedModal);
document.getElementById('feedClose').addEventListener('click', closeFeedModal);
document.getElementById('feedModal').addEventListener('click', (e) => {
    if (e.target.id === 'feedModal') closeFeedModal();
});

document.querySelectorAll('.feed-option').forEach((btn) => {
    btn.addEventListener('click', (e) => {
        const portions = e.target.getAttribute('data-portions');
        addLog('Вы', `Рыб накормлено (${portions} порций)`);
        closeFeedModal();
    });
});

document.getElementById('tempSlider').addEventListener('input', (e) => {
    document.getElementById('tempValue').textContent = e.target.value;
});

document.getElementById('tempApply').addEventListener('click', () => {
    const temp = parseInt(document.getElementById('tempSlider').value, 10);
    setStorageValue(TEMP_STORAGE_KEY, temp);
    addLog('Вы', `Установлена целевая температура: ${temp}°C`);
    closeTempModal();
});

document.getElementById('tempClose').addEventListener('click', closeTempModal);
document.getElementById('tempModal').addEventListener('click', (e) => {
    if (e.target.id === 'tempModal') closeTempModal();
});

// Добавляем обработчик на кнопку "Свет" для открытия меню температуры из главного экрана
document.querySelector('.status-circle')?.addEventListener('click', openTempModal);