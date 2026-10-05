// ==UserScript==
// @name         ChatGPT Response Favicon
// @namespace    https://chatgpt.com/
// @version      1.5.1
// @description  Chat/Workの変化をファビコンとデスクトップ通知で知らせ、使用状況ページで利用枠の回復を監視。
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '1.5.1';
    const INSTANCE_KEY = '__chatgptResponseFaviconV2';
    const ICON_ID = 'chatgpt-response-favicon';
    const RESTORE_ID = `${ICON_ID}-restore`;
    const GRACE_MS = 3000;
    const QUIET_MS = 1000;
    const POLL_MS = 500;
    const STALL_MINUTES = 30;
    const STALL_MS = STALL_MINUTES * 60 * 1000;
    const ERROR_GRACE_MS = 2000;
    const ATTRS = ['href', 'type', 'sizes'];
    const DONE_ICON = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
        '<circle cx="32" cy="32" r="30" fill="#16a34a"/>' +
        '<path d="M18 33 28 43 47 22" fill="none" stroke="white" ' +
        'stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    );
    const warningIcon = color => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
        `<path d="M32 5 61 57H3Z" fill="${color}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>` +
        '<path d="M32 23v15" stroke="#111827" stroke-width="6" stroke-linecap="round"/>' +
        '<circle cx="32" cy="47" r="3.5" fill="#111827"/></svg>'
    );
    const ICONS = { done: DONE_ICON, stalled: warningIcon('#fbbf24'), error: warningIcon('#ef4444') };
    const isOurIcon = href => Object.values(ICONS).includes(href);
    const ERROR_SELECTOR = '[role="alert"], [role="status"], [aria-live="assertive"], ' +
        '[data-testid*="error" i], [data-testid*="failure" i], [data-state="error"], [data-status="error"]';
    const ERROR_PATTERN = /usage limit reached|(?:you(?:'|’)ve|you have) reached.{0,35}limit|利用上限に達|使用上限に達|something went wrong|(?:an? )?error (?:occurred|has occurred|generating|while generating)|(?:network|server|connection) (?:error|issue|interrupted|lost|failed)|(?:unable|failed) to (?:generate|connect|fetch)|エラーが発生|生成.{0,15}(?:失敗|エラー)|(?:通信|ネットワーク|接続).{0,12}(?:エラー|中断|失敗|切断)/i;
    const PROGRESS_SKIP = 'script, style, button, .turn-action-controls, [contenteditable], ' +
        '[hidden], [aria-hidden="true"], [role="timer"], time, [data-testid*="timer" i], [data-testid*="duration" i]';
    const PROGRESS_OUTSIDE = 'nav, aside, header, [role="dialog"], [role="menu"], [role="listbox"], ' +
        '[role="complementary"], [class~="group/user-message"], [data-turn="user"], [data-message-author-role="user"]';
    const STOP_SELECTOR = [
        'button[data-testid="stop-button"]',
        'button[aria-label="Stop streaming"]',
        'button[aria-label="Stop generating"]',
        'button[aria-label="生成を停止"]',
        'button[aria-label="生成を停止する"]',
        'button[aria-label="ストリーミングを停止"]',
        'button[aria-label="ストリーミングを停止する"]',
        'button[aria-label="回答の生成を停止"]',
        'form:has(#prompt-textarea) button[aria-label="Stop"]',
        'form[data-chatgpt-composer] button[aria-label="Stop"]'
    ].join(',');
    const SEND_SELECTOR = 'button[data-testid="send-button"], button#composer-submit-button';
    const RICH_EDITOR_SELECTOR = [
        'Work', 'Chat', 'チャット', 'メッセージ', 'Message', 'Prompt', 'Ask'
    ].map(name => `.ProseMirror[role="textbox"][aria-label*="${name}" i]`).join(',');
    const COMPOSER_SELECTOR = [
        '#prompt-textarea', '[data-testid="composer-input"]',
        ...RICH_EDITOR_SELECTOR.split(',').map(selector => `${selector}[contenteditable="true"]`)
    ].join(',');
    const COPY_SELECTOR = [
        'button[data-testid="copy-turn-action-button"]',
        'button[aria-label="メッセージをコピーする"]',
        'button[aria-label="回答をコピーする"]',
        'button[aria-label="Copy message"]', 'button[aria-label="Copy response"]'
    ].join(',');
    const REGENERATE_SELECTOR = [
        'button[aria-label="回答を再生成"]',
        'button[aria-label="Regenerate response"]', 'button[aria-label="Regenerate"]',
        'button[data-testid="regenerate-turn-action-button"]'
    ].join(',');
    const WORK_EDITOR_SELECTOR = RICH_EDITOR_SELECTOR;
    const HEAD_OPTIONS = {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['href', 'rel', 'type', 'sizes', 'media']
    };

    if (!document.head || !document.body) return;
    window[INSTANCE_KEY]?.dispose();

    const events = new AbortController();
    const originals = new Map();
    const nodeIds = new WeakMap();
    const menuIds = [];
    let nextNodeId = 0;
    let notified = false;
    let noticeKind = null;
    let lastNotice = null;
    let pending = null;
    let lastOriginal = null;
    let scheduled = null;
    let testTimer = null;
    let refreshTimer = null;
    let route = location.pathname;
    let disposed = false;

    // デスクトップ通知と利用枠監視。会話本文を通知へコピーしない。
    const DESKTOP_INTERVAL_MS = 60000;
    const DESKTOP_DELAY_MS = 5000;
    const USAGE_CONFIRM_MS = 2000;
    const USAGE_RELOAD_MS = 60000;
    const USAGE_TTL_MS = 8 * 24 * 60 * 60 * 1000;
    const USAGE_STORAGE_KEY = 'chatgpt-response-favicon:usage:v1';
    const desktopDefaults = { desktop: true, progress: true, usage: true, usageReload: true };
    let desktopLast = null;
    let desktopTestTimer = null;
    let usageMonitor = null;
    let lastUsageScan = 0;
    let usageLastSnapshot = { status: 'inactive', rows: [], unknownLabels: [] };
    let usageStorageOK = true;

    function preference(name) {
        try {
            return typeof GM_getValue === 'function' ?
                GM_getValue(`crf:${name}`, desktopDefaults[name]) !== false : desktopDefaults[name];
        } catch { return desktopDefaults[name]; }
    }

    function togglePreference(name) {
        if (typeof GM_setValue !== 'function') {
            alert('設定の保存機能を使えません。Tampermonkeyで最新版を保存し、ページを再読み込みしてください。');
            return;
        }
        const enabled = !preference(name);
        try {
            GM_setValue(`crf:${name}`, enabled);
            alert(`${name === 'desktop' ? 'デスクトップ通知' : name === 'progress' ? '途中経過の通知' : name === 'usage' ? '利用枠の回復通知' : '使用状況の自動更新'}：${enabled ? 'ON' : 'OFF'}`);
        } catch { alert('設定を保存できませんでした。'); }
    }

    function desktopNotify(kind, message = '', options = {}) {
        if (!options.test && (!preference('desktop') ||
            (kind === 'usage' && !preference('usage')))) return true;
        if (!options.allowVisible && document.visibilityState === 'visible') return true;
        const captions = {
            done: ['回答完了', '回答が完了しました。'],
            stalled: ['進捗が止まっています', `${STALL_MINUTES}分以上、画面上の進捗更新を検出していません。`],
            error: ['エラーを検出', 'エラー表示またはオフライン状態を検出しました。チャットを確認してください。'],
            progress: ['作業が更新されました', '回答または作業表示に更新がありました。'],
            resumed: ['作業が再開しました', '警告後に、画面上の進捗更新を検出しました。'],
            attention: ['確認が必要です', '承認・確認を待つ表示を検出しました。チャットを確認してください。'],
            usage: ['利用枠が回復しました', message],
            test: ['通知テスト', 'デスクトップ通知を表示できました。']
        };
        const [caption, body] = captions[kind] || captions.progress;
        const target = options.url || `${location.origin}${location.pathname}${location.search}${location.hash}`;
        const title = (document.title || 'ChatGPT').replace(/\s+/g, ' ').trim().slice(0, 80);
        const details = {
            title: `ChatGPT：${caption}`,
            text: kind === 'usage' || kind === 'test' ? body : `${title}\n${body}`,
            tag: kind === 'usage' ? 'crf:usage-recovery' : `crf:conversation:${location.pathname}`,
            // 通知だけでChromeを前面化しない。通知をクリックした場合のURL処理はTampermonkey/OS側に任せる。
            highlight: false, silent: false, timeout: 15000, url: target
        };
        if (typeof GM_notification !== 'function') {
            desktopLast = { kind, at: Date.now(), status: 'unavailable' };
            return false;
        }
        try {
            GM_notification(details);
            // APIへの依頼成功であり、OS上の表示成功までは判定できない。
            desktopLast = { kind, at: Date.now(), status: 'requested' };
            return true;
        } catch {
            desktopLast = { kind, at: Date.now(), status: 'failed' };
            return false;
        }
    }

    function testDesktopInFiveSeconds() {
        clearTimeout(desktopTestTimer);
        desktopTestTimer = setTimeout(() => {
            desktopTestTimer = null;
            desktopNotify('test', '', { test: true, allowVisible: true });
        }, 5000);
        console.info('[ChatGPT Response Favicon] 約5秒後にデスクトップ通知をテストします。');
    }

    function progressDesktop(changed, errorActive, recovered = false) {
        if (!pending) return;
        const now = Date.now();
        if (document.visibilityState === 'visible' || !preference('progress') || errorActive) {
            pending.desktopProgressDue = null;
            pending.desktopProgressKind = null;
            return;
        }
        if (changed && pending.desktopProgressDue == null) {
            pending.desktopProgressDue = Math.max(now + DESKTOP_DELAY_MS,
                (pending.desktopProgressAt || 0) + DESKTOP_INTERVAL_MS);
            pending.desktopProgressKind = recovered ? 'resumed' : 'progress';
        }
        if (pending.desktopProgressDue != null && now >= pending.desktopProgressDue) {
            desktopNotify(pending.desktopProgressKind || 'progress');
            pending.desktopProgressAt = now;
            pending.desktopProgressDue = null;
            pending.desktopProgressKind = null;
        }
    }

    function attentionDesktop() {
        if (!pending) return;
        const pattern = /approval required|waiting for (?:approval|confirmation)|permission required|承認.{0,6}(?:必要|待ち)|許可.{0,6}(?:必要|待ち)|確認が必要/i;
        const selectors = '[role="dialog"], [role="alertdialog"], [data-testid*="approval" i], [data-testid*="confirmation" i]';
        const texts = [...document.querySelectorAll(selectors)]
            .filter(node => isVisible(node) && !node.closest('pre, code, [contenteditable]'))
            .map(node => normalizedProgress(node.textContent || '').slice(0, 500))
            .filter(text => pattern.test(text));
        if (!texts.length) { pending.attention = null; return; }
        const key = texts.join('|');
        if (pending.attention?.key !== key) pending.attention = { key, since: Date.now(), sent: false };
        if (!pending.attention.sent && Date.now() - pending.attention.since >= 2000) {
            desktopNotify('attention');
            pending.attention.sent = true;
        }
    }

    function isUsagePage() {
        const path = location.pathname.replace(/\/+$/, '').toLowerCase();
        const hash = location.hash.toLowerCase();
        const overview = !new URLSearchParams(location.search).get('tab') ||
            new URLSearchParams(location.search).get('tab') === 'overview';
        return overview && (path === '/settings/usage' || /^#settings\/usage(?:$|[/?])/.test(hash));
    }

    function usageText(root) {
        const skip = 'script, style, nav, aside, button, input, textarea, [contenteditable], [hidden], [aria-hidden="true"]';
        const text = [];
        const visibility = new Map();
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const parent = walker.currentNode.parentElement;
            if (!parent || parent.closest(skip)) continue;
            if (!visibility.has(parent)) visibility.set(parent, isVisible(parent));
            if (visibility.get(parent)) text.push(walker.currentNode.nodeValue || '');
        }
        return text.join(' ').normalize('NFKC').replace(/\s+/g, ' ').trim();
    }

    function usageLabel(text) {
        const label = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
        if (!label || label.length > 100 || /%|resets?\b|リセット|残り|remaining|\d:\d/.test(label)) return null;
        if (/^(?:(?:\d+|five)[ -]?hours?(?:\s+(?:usage|limit))?|\d+\s*時間(?:あたり|ごと)?(?:の)?(?:利用|使用)?(?:上限|制限|量|枠)?)$/i.test(label)) {
            const hours = /five/i.test(label) ? '5' : label.match(/\d+/)?.[0];
            return { key: `hours-${hours}`, label };
        }
        if (/^(?:weekly(?:\s+(?:usage|limit))?(?:\s*\([^)]{1,40}\))?|(?:1\s*週間|週間|週次|週ごと)(?:の)?(?:利用|使用)?(?:上限|制限|量|枠)?)$/i.test(label)) {
            return { key: label.toLowerCase().includes('(') ? `weekly-${label.toLowerCase()}` : 'weekly', label };
        }
        if (/^(?:code reviews?(?:\s+(?:usage|limit))?|コードレビュー(?:の)?(?:上限|使用量)?)$/i.test(label)) {
            return { key: 'code-review', label };
        }
        return null;
    }

    function usageMetric(text) {
        const normalized = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
        const values = [];
        const number = '(\\d+(?:[.,]\\d+)?)\\s*%';
        const rules = [
            [new RegExp(number + '\\s*(?:remaining|left|available|残り|残っています|利用可能)', 'gi'), false],
            [new RegExp('(?:remaining|left|残り|残量|利用可能)\\s*[:：]?\\s*' + number, 'gi'), false],
            [new RegExp(number + '\\s*(?:used|consumed|使用済み|使用|利用済み|消費)', 'gi'), true],
            [new RegExp('(?:used|consumed|使用済み|使用率|利用率|使用量)\\s*[:：]?\\s*' + number, 'gi'), true]
        ];
        for (const [regex, used] of rules) {
            for (const match of normalized.matchAll(regex)) {
                const value = Number(match[1].replace(',', '.'));
                if (Number.isFinite(value) && value >= 0 && value <= 100) values.push(used ? 100 - value : value);
            }
        }
        const blocked = /(?:usage|rate|message|weekly|\d[ -]?hour)\s+limit\s+(?:reached|exceeded)|(?:limit|quota)\s+exhausted|(?:利用|使用|週間|週次)(?:量|回数)?(?:の)?上限に(?:達|到達)|上限に達しました/i.test(normalized);
        const available = /\blimit (?:has been reset|has (?:been )?lifted|is lifted)\b|\busage (?:is )?available again\b|(?:利用|使用)(?:の)?制限が解除されました|再び利用できます/i.test(normalized);
        if (values.length) {
            if (values.some(value => Math.abs(value - values[0]) > 0.01)) return null;
            const remaining = values[0];
            if ((blocked && remaining > 0) || (available && remaining === 0)) return null;
            return { state: remaining === 0 ? 'blocked' : 'available', remaining };
        }
        if (blocked === available) return null;
        return { state: blocked ? 'blocked' : 'available', remaining: null };
    }

    function usageSnapshot() {
        if (!isUsagePage()) return { status: 'inactive', rows: [], unknownLabels: [] };
        const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(isVisible);
        const scope = dialogs.at(-1) || document.querySelector('main, [role="main"]') || document.body;
        const labels = [];
        for (const element of scope.querySelectorAll('h1, h2, h3, h4, [role="heading"], dt, p, span, div, label')) {
            if (element.closest('nav, aside, [hidden], [aria-hidden="true"], button, [contenteditable]') || !isVisible(element)) continue;
            const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
            const label = usageLabel(text);
            if (!label || [...element.children].some(child => usageLabel(child.textContent || '')?.key === label.key)) continue;
            labels.push({ element, ...label });
        }
        const rows = new Map();
        const conflicts = new Set();
        const unknownLabels = new Set();
        for (const label of labels) {
            let found = false;
            for (let card = label.element, depth = 0; card && depth < 7; card = card.parentElement, depth++) {
                if (!scope.contains(card) && card !== scope) break;
                if (labels.some(other => other.key !== label.key && card.contains(other.element))) break;
                let text = usageText(card);
                if (text.length > 1500) break;
                for (const bar of card.querySelectorAll('[role="progressbar"], meter')) {
                    if (!isVisible(bar)) continue;
                    const ariaText = bar.getAttribute('aria-valuetext');
                    if (ariaText) text += ` ${ariaText}`;
                    const ariaLabel = bar.getAttribute('aria-label') || '';
                    const raw = bar.getAttribute('aria-valuenow');
                    const maximum = Number(bar.getAttribute('aria-valuemax') || 100);
                    const minimum = Number(bar.getAttribute('aria-valuemin') || 0);
                    if (raw !== null && maximum > minimum && /remaining|used|残り|残量|使用率/i.test(ariaLabel)) {
                        const percentage = (Number(raw) - minimum) / (maximum - minimum) * 100;
                        text += ` ${ariaLabel}: ${percentage}%`;
                    }
                }
                const metric = usageMetric(text);
                if (!metric) continue;
                const previous = rows.get(label.key);
                if (previous && (previous.state !== metric.state || previous.remaining !== metric.remaining)) conflicts.add(label.key);
                rows.set(label.key, { key: label.key, label: label.label, ...metric });
                found = true;
                break;
            }
            if (!found) unknownLabels.add(label.label);
        }
        for (const key of conflicts) { unknownLabels.add(rows.get(key).label); rows.delete(key); }
        const result = [...rows.values()];
        return { status: result.length ? 'recognized' : 'unknown', rows: result, unknownLabels: [...unknownLabels] };
    }

    function readUsageState() {
        try {
            const data = JSON.parse(sessionStorage.getItem(USAGE_STORAGE_KEY) || 'null');
            if (data?.version === 1 && data.updatedAt <= Date.now() && Date.now() - data.updatedAt < USAGE_TTL_MS &&
                data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries)) {
                return Object.fromEntries(Object.entries(data.entries).filter(([, entry]) =>
                    entry && ['blocked', 'available'].includes(entry.state) && Number.isFinite(entry.at) &&
                    entry.at <= Date.now() && Date.now() - entry.at < USAGE_TTL_MS));
            }
        } catch { usageStorageOK = false; }
        return {};
    }

    function saveUsageState() {
        try {
            sessionStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify({
                version: 1, updatedAt: Date.now(), entries: usageMonitor.entries
            }));
            usageStorageOK = true;
        } catch { usageStorageOK = false; }
    }

    function checkUsageMonitor() {
        if (!isUsagePage()) {
            usageMonitor = null;
            usageLastSnapshot = { status: 'inactive', rows: [], unknownLabels: [] };
            return false;
        }
        const now = Date.now();
        if (!usageMonitor) {
            usageMonitor = { entries: readUsageState(), candidates: new Map(), reloadAt: now + USAGE_RELOAD_MS, retryAt: 0 };
            lastUsageScan = 0;
        }
        if (now - lastUsageScan < 1000) return true;
        lastUsageScan = now;
        const snapshot = usageSnapshot();
        usageLastSnapshot = snapshot;
        const current = new Map(snapshot.rows.map(row => [row.key, row]));
        for (const key of usageMonitor.candidates.keys()) if (!current.has(key)) usageMonitor.candidates.delete(key);
        const recovered = [];
        let dirty = false;
        for (const row of snapshot.rows) {
            let candidate = usageMonitor.candidates.get(row.key);
            if (!candidate || candidate.state !== row.state) {
                candidate = { state: row.state, since: now };
                usageMonitor.candidates.set(row.key, candidate);
            }
            if (now - candidate.since < USAGE_CONFIRM_MS) continue;
            const previous = usageMonitor.entries[row.key];
            if (previous?.state === 'blocked' && row.state === 'available' &&
                now - previous.at < USAGE_TTL_MS) {
                // 通知APIが失敗した場合は、成功するまで制限中の記録を残す。
                recovered.push(row);
            } else if (!previous || previous.state !== row.state || now - previous.at >= USAGE_RELOAD_MS) {
                usageMonitor.entries[row.key] = { state: row.state, at: now };
                dirty = true;
            }
        }
        if (recovered.length && now >= usageMonitor.retryAt) {
            const names = recovered.map(row => `${row.label}${row.remaining === null ? '' : `（残り${Number(row.remaining.toFixed(2))}%）`}`).join('、');
            const blocked = snapshot.rows.filter(row => row.state === 'blocked').map(row => row.label);
            const caveat = blocked.length ? ` ${blocked.join('、')}はまだ上限に達しています。` :
                snapshot.unknownLabels.length ? ' 読み取れない利用枠もあるため、使用状況ページを確認してください。' : '';
            if (desktopNotify('usage', `${names}の回復を確認しました。${caveat}`, { allowVisible: true })) {
                for (const row of recovered) usageMonitor.entries[row.key] = { state: row.state, at: now };
                usageMonitor.retryAt = 0;
                dirty = true;
            } else {
                usageMonitor.retryAt = now + DESKTOP_INTERVAL_MS;
            }
        }
        if (dirty) saveUsageState();
        // 閲覧中・入力中・オフラインでは再読み込みしない。記録を保存できない場合も停止する。
        if (now >= usageMonitor.reloadAt && preference('usage') && preference('usageReload') && usageStorageOK &&
            snapshot.rows.length > 0 && document.visibilityState === 'hidden' && navigator.onLine !== false &&
            typeof GM_notification === 'function' &&
            !document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) {
            saveUsageState();
            if (usageStorageOK) {
                usageMonitor.reloadAt = now + USAGE_RELOAD_MS;
                location.reload();
            }
        }
        return true;
    }

    function usageDiagnostics() {
        return {
            version: VERSION, page: isUsagePage() ? 'usage-overview' : 'other',
            ...usageSnapshot(), desktopAPI: typeof GM_notification === 'function',
            desktopEnabled: preference('desktop'), usageEnabled: preference('usage'),
            autoReload: preference('usageReload'), savedState: usageStorageOK,
            lastDesktop: desktopLast,
            blockedBefore: Object.entries(usageMonitor?.entries || {}).filter(([,value]) => value.state === 'blocked').map(([key]) => key)
        };
    }

    function showUsageDiagnostics() {
        const data = usageDiagnostics();
        console.info('[ChatGPT Response Favicon] 利用上限の診断', data);
        prompt('利用上限の診断です。必要なら全文をコピーできます。', JSON.stringify(data, null, 2));
    }

    function nativeIcons() {
        return [...document.head.querySelectorAll('link[rel~="icon"]')]
            .filter(link => link.id !== ICON_ID && link.id !== RESTORE_ID);
    }

    function attrsOf(link) {
        return Object.fromEntries(ATTRS.map(name => [name, link.getAttribute(name)]));
    }

    function setAttr(element, name, value) {
        if (element.getAttribute(name) === value) return;
        if (value === null) element.removeAttribute(name);
        else element.setAttribute(name, value);
    }

    // 自分の変更を再び監視しない。属性の無条件再設定によるループも避ける。
    function changeHead(fn) {
        headObserver.disconnect();
        try { fn(); }
        finally { if (!disposed) headObserver.observe(document.head, HEAD_OPTIONS); }
    }

    function syncNotificationIcon(records = []) {
        if (!notified) return;
        const desired = { href: ICONS[noticeKind] || DONE_ICON, type: 'image/svg+xml', sizes: 'any' };

        // サイトが通知中に元アイコンを更新した場合、その新しい値を復元先にする。
        for (const record of records) {
            const original = originals.get(record.target);
            if (record.type !== 'attributes' || !original || !ATTRS.includes(record.attributeName)) continue;
            const value = record.target.getAttribute(record.attributeName);
            if (value !== desired[record.attributeName]) {
                original[record.attributeName] = value;
                if (original.href && !isOurIcon(original.href)) lastOriginal = { ...original };
            }
        }

        changeHead(() => {
            clearTimeout(refreshTimer);
            document.getElementById(RESTORE_ID)?.remove();
            for (const link of nativeIcons()) {
                if (!originals.has(link)) {
                    const original = attrsOf(link);
                    // サイトが変更済み要素を複製した場合、緑アイコンを元画像にしない。
                    if (isOurIcon(original.href) && lastOriginal) Object.assign(original, lastOriginal);
                    originals.set(link, original);
                    if (original.href && !isOurIcon(original.href)) lastOriginal = { ...original };
                }
                for (const name of ATTRS) setAttr(link, name, desired[name]);
            }
            let icon = document.getElementById(ICON_ID);
            if (!icon) {
                icon = document.createElement('link');
                icon.id = ICON_ID;
                document.head.appendChild(icon);
            }
            setAttr(icon, 'rel', 'icon');
            for (const name of ATTRS) setAttr(icon, name, desired[name]);
        });
    }

    function restoreIcon() {
        if (!notified && originals.size === 0 && !document.getElementById(ICON_ID)) return;
        notified = false;
        noticeKind = null;
        changeHead(() => {
            for (const [link, original] of originals) {
                if (link.isConnected) {
                    for (const name of ATTRS) setAttr(link, name, original[name]);
                }
            }
            originals.clear();
            document.getElementById(ICON_ID)?.remove();
            document.getElementById(RESTORE_ID)?.remove();
            clearTimeout(refreshTimer);

            const icons = nativeIcons();
            const original = icons.find(link => link.getAttribute('href') &&
                (!link.media || matchMedia(link.media).matches)) || icons.find(link => link.getAttribute('href'));
            const fallback = original ? attrsOf(original) : lastOriginal;
            if (!fallback?.href || isOurIcon(fallback.href)) return;

            // 元URLをもう一度明示する。追加した緑アイコンを削除するだけにしない。
            const refresh = document.createElement('link');
            refresh.id = RESTORE_ID;
            refresh.rel = 'icon';
            for (const name of ATTRS) setAttr(refresh, name, fallback[name]);
            document.head.appendChild(refresh);
            if (original) refreshTimer = setTimeout(() => refresh.remove(), 2000);
        });
    }

    function acknowledge() {
        // hasFocus()は要求しない。タブ切り替え時にfocusイベントを取りこぼしても復元する。
        if (document.visibilityState === 'visible') restoreIcon();
    }

    function notify(kind = 'done', reason = '') {
        lastNotice = { kind, reason, at: Date.now() };
        if (document.visibilityState === 'visible') { restoreIcon(); return; }
        desktopNotify(kind);
        noticeKind = kind;
        notified = true;
        syncNotificationIcon();
    }

    function isVisible(element) {
        const style = getComputedStyle(element);
        return element.getClientRects().length > 0 && style.display !== 'none' &&
            style.visibility !== 'hidden' && style.visibility !== 'collapse';
    }

    function nodeKey(node) {
        if (!node) return 'none';
        if (!nodeIds.has(node)) nodeIds.set(node, ++nextNodeId);
        return `node-${nodeIds.get(node)}`;
    }

    function workAnswerRoot(button) {
        let controls = button.closest('.turn-action-controls');
        if (!controls) return null;
        // Workではコピー操作の内側と外側に同じクラスが付く。
        let outer;
        while ((outer = controls.parentElement?.closest('.turn-action-controls'))) controls = outer;
        const root = controls.parentElement;
        if (!root || root === document.body || root === document.documentElement) return null;
        // ユーザーメッセージのコピー操作を回答と混同しない。
        if (button.closest('[class~="group/user-message"], [data-turn="user"], [data-message-author-role="user"]') ||
            root.className.includes('/user-message') || root.classList.contains('flex-row-reverse')) return null;
        return root;
    }

    function turns(role) {
        const selector = `[data-message-author-role="${role}"], [data-turn="${role}"]`;
        const found = new Set([...document.querySelectorAll(selector)].map(node =>
            node.closest('[data-testid^="conversation-turn-"]') ||
            node.closest(`[data-turn="${role}"]`) || node
        ));
        if (role === 'assistant') {
            for (const button of document.querySelectorAll(`${COPY_SELECTOR}, ${REGENERATE_SELECTOR}`)) {
                if (button.closest('[data-message-author-role], [data-turn], [data-testid^="conversation-turn-"]')) continue;
                const root = workAnswerRoot(button);
                if (root) found.add(root);
            }
        }
        return [...found].sort((a, b) => a === b ? 0 :
            a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    }

    function nearComposer(button) {
        for (let parent = button.parentElement, i = 0; parent && i < 10; parent = parent.parentElement, i++) {
            if (parent === document.body || parent === document.documentElement) break;
            if (parent.querySelector(`${COMPOSER_SELECTOR}, ${WORK_EDITOR_SELECTOR}`)) return true;
        }
        return false;
    }

    function controlLabel(button) {
        return (button.getAttribute('aria-label') || button.getAttribute('title') ||
            button.textContent || '').trim();
    }

    function isStopButton(button) {
        if (button.matches(STOP_SELECTOR)) return true;
        if (!/^(?:Stop(?: generating| streaming| response| task)?|停止(?:する)?|(?:生成|回答|処理|タスク|ストリーミング)を停止(?:する)?)$/i.test(controlLabel(button))) return false;
        return Boolean(document.querySelector(WORK_EDITOR_SELECTOR)) && nearComposer(button);
    }

    function isSendButton(button) {
        if (button.matches(SEND_SELECTOR)) return true;
        return /^(?:Send(?: prompt| message)?|Submit|(?:メッセージ|プロンプト)?(?:を)?送信(?:する)?)$/i.test(controlLabel(button)) && nearComposer(button);
    }

    function enabled(button) {
        return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
    }

    function snapshot() {
        const assistantTurns = turns('assistant');
        const last = assistantTurns.at(-1);
        const message = last?.matches('[data-message-author-role="assistant"]') ? last :
            last?.querySelector('[data-message-author-role="assistant"]') || last;
        const text = message?.textContent || '';
        const key = message?.getAttribute('data-message-id') || last?.getAttribute('data-message-id') ||
            last?.getAttribute('data-testid') || nodeKey(last);
        const copy = [...(last?.querySelectorAll(COPY_SELECTOR) || [])].find(button => enabled(button) && isVisible(button));
        const regenerate = [...(last?.querySelectorAll(REGENERATE_SELECTOR) || [])].find(button => enabled(button) && isVisible(button));
        const streaming = [...document.querySelectorAll('button')].some(button => isStopButton(button) && isVisible(button)) ||
            Boolean(last?.matches('[data-is-streaming="true"]') || message?.matches('[data-is-streaming="true"]'));
        return {
            key, hasCopy: Boolean(copy), hasActions: Boolean(copy || regenerate), streaming,
            hasContent: text.trim().length > 0,
            signature: `${key}|${text.length}|${text.slice(-512)}`,
            actions: `${nodeKey(copy)}|${nodeKey(regenerate)}`,
            assistantCount: assistantTurns.length,
            layout: /work/i.test(document.querySelector(WORK_EDITOR_SELECTOR)?.getAttribute('aria-label') || '') ?
                'Work' : (document.querySelector(COMPOSER_SELECTOR) || assistantTurns.length) ? 'Chat' : 'unknown'
        };
    }

    function normalizedProgress(text) {
        return text.replace(/\b(?:thinking|thought) for\s+(?:\d+(?:\.\d+)?\s*(?:milliseconds?|seconds?|minutes?|hours?|ms|[hms])\b[\s,]*|\d+(?::\d+){1,2})+/gi, 'Thinking')
            .replace(/思考(?:時間|中)?[：:\s]*\d+(?:時間|分|秒|\d|\s|[.:])*/g, '思考中')
            .replace(/^\s*(?:\d+(?:\.\d+)?\s*(?:ms|s|m|h|seconds?|minutes?|hours?|秒|分|時間)\s*)+$/i, '')
            .replace(/\s+/g, ' ').trim();
    }

    function progressToken() {
        const roots = new Set(turns('assistant'));
        for (const root of document.querySelectorAll('.group.flex.flex-col')) {
            if (!root.closest(PROGRESS_OUTSIDE) && !root.querySelector(COMPOSER_SELECTOR) &&
                !root.matches('[class*="/user-message"]') && isVisible(root)) roots.add(root);
        }
        const ordered = [...roots].filter(root => !root.closest(PROGRESS_OUTSIDE) && isVisible(root))
            .sort((a,b) => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
        let root = ordered.at(-1);
        // 同じ回答内の内側のグループも、回答全体として読む。
        while (root && ordered.some(other => other !== root && other.contains(root))) {
            root = ordered.find(other => other !== root && other.contains(root));
        }
        if (!root) return '';
        const pieces = [];
        const visibility = new Map();
        const visible = element => {
            if (!visibility.has(element)) visibility.set(element, isVisible(element));
            return visibility.get(element);
        };
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const parent = walker.currentNode.parentElement;
            if (!parent || parent.closest(PROGRESS_SKIP) || !visible(parent)) continue;
            const status = parent.closest(ERROR_SELECTOR);
            if (status && ERROR_PATTERN.test(status.textContent || '')) continue;
            const text = normalizedProgress(walker.currentNode.nodeValue || '');
            if (text) pieces.push(text);
        }
        for (const bar of root.querySelectorAll('[role="progressbar"][aria-valuenow]')) {
            if (!bar.closest(PROGRESS_SKIP) && visible(bar)) pieces.push(`progress:${bar.getAttribute('aria-valuenow')}`);
        }
        // DOMの作り直し、点滅、経過時間だけでは進捗時計を戻さない。
        const text = pieces.join(' ');
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
        return `${text.length}:${hash >>> 0}`;
    }

    function visibleErrors() {
        const found = new Map();
        if (navigator.onLine === false) found.set('offline', { key: 'offline', text: 'ネットワーク接続がオフラインです。' });
        for (const element of document.querySelectorAll(ERROR_SELECTOR)) {
            if (element.closest('pre, code, [contenteditable], [data-turn="user"], [data-message-author-role="user"], [class~="group/user-message"]') || !isVisible(element)) continue;
            const text = (element.textContent || '').replace(/\s+/g,' ').trim();
            if (!text || text.length > 1000 || !ERROR_PATTERN.test(text)) continue;
            const key = normalizedProgress(text).replace(/(?:retry|try again) in \d+\s*(?:seconds?|s)/gi, 'retry');
            found.set(key, { key, text: text.slice(0,240) });
        }
        return [...found.values()];
    }

    function arm(reason, state = snapshot(), force = false) {
        if (isUsagePage()) return;
        if (pending && !pending.cancelled && !force && !pending.currentError) return;
        restoreIcon();
        clearTimeout(testTimer);
        testTimer = null;
        const baselineErrors = new Set(visibleErrors().map(error => error.key));
        // 再試行直後も、現在の障害が消えるまで正常完了にしない。
        if (pending?.errorCandidate) baselineErrors.delete(pending.errorCandidate.key);
        pending = {
            reason, baseline: state.signature, baselineActions: state.actions, started: performance.now(),
            sawStreaming: false, stoppedAt: null, quietAt: performance.now(),
            signature: state.signature, actions: state.actions, sawMissingActions: false, cancelled: false,
            progress: progressToken(), lastProgressAt: Date.now(), stallWarned: false,
            baselineErrors, desktopProgressDue: null, desktopProgressAt: 0, desktopProgressKind: null, attention: null,
            warnedErrors: new Set(), errorCandidate: null, currentError: null, resumeBaseline: null
        };
    }

    function monitorWaiting(state) {
        const wallNow = Date.now();
        const progress = progressToken();
        const errors = visibleErrors();
        const keys = new Set(errors.map(error => error.key));
        for (const key of pending.baselineErrors) if (!keys.has(key)) pending.baselineErrors.delete(key);
        for (const key of pending.warnedErrors) if (!keys.has(key)) pending.warnedErrors.delete(key);
        const error = errors.find(item => item.key === 'offline' || !pending.baselineErrors.has(item.key));
        const progressChanged = progress !== pending.progress;
        const recovered = progressChanged && !error && (pending.stallWarned || Boolean(pending.errorCandidate));
        if (progressChanged) {
            pending.progress = progress;
            pending.lastProgressAt = wallNow;
            // Work等で停止ボタンが一時的に消えても、画面上の進捗が続く限り完了候補をリセットする。
            pending.stoppedAt = null;
            pending.quietAt = performance.now();
            pending.stallWarned = false;
            if (noticeKind === 'stalled' || (noticeKind === 'error' && !error)) restoreIcon();
        }
        progressDesktop(progressChanged, Boolean(error), recovered);
        pending.currentError = error?.text || null;
        if (error) {
            if (pending.errorCandidate?.key !== error.key) {
                pending.errorCandidate = { key: error.key, since: wallNow };
                pending.resumeBaseline = { signature: state.signature, actions: state.actions };
            }
            if (!pending.warnedErrors.has(error.key) && wallNow - pending.errorCandidate.since >= ERROR_GRACE_MS &&
                wallNow - pending.lastProgressAt >= ERROR_GRACE_MS) {
                pending.warnedErrors.add(error.key);
                notify('error', error.text);
            }
            pending.stoppedAt = null;
            return true;
        }
        pending.errorCandidate = null;
        // 長く間引かれた監視が、完了操作の出現と同時に再開した場合は完了判定を優先する。
        const changedResult = state.signature !== pending.baseline || state.actions !== pending.baselineActions;
        const freshResult = !pending.resumeBaseline || state.signature !== pending.resumeBaseline.signature ||
            state.actions !== pending.resumeBaseline.actions;
        const completing = !state.streaming && changedResult && freshResult &&
            (state.hasActions || (pending.sawStreaming && state.hasContent));
        if (!pending.stallWarned && !completing && wallNow - pending.lastProgressAt >= STALL_MS) {
            pending.stallWarned = true;
            pending.resumeBaseline = { signature: state.signature, actions: state.actions };
            // エラーの赤い警告は、停滞の黄色へ格下げしない。
            if (noticeKind !== 'error') notify('stalled', `${STALL_MINUTES}分以上、画面上の進捗更新を検出していません。`);
        }
        return false;
    }

    function check() {
        clearTimeout(scheduled);
        scheduled = null;
        if (disposed) return;
        acknowledge();
        if (checkUsageMonitor()) { pending = null; restoreIcon(); route = location.pathname; return; }
        const state = snapshot();
        const now = performance.now();
        if (location.pathname !== route) {
            // 最初の送信で新規チャットにIDが付く遷移は、待機を引き継ぐ。
            const newChat = pending && !/\/(?:c|work)\/[^/]+/.test(route) && /\/(?:c|work)\/[^/]+/.test(location.pathname) &&
                now - pending.started < 15000;
            if (!newChat) { pending = null; restoreIcon(); }
            route = location.pathname;
        }

        if (state.streaming && !pending) arm('generation', state);
        if (!pending) return;
        if (pending.cancelled) {
            restoreIcon();
            if (!state.streaming) pending = null;
            return;
        }
        if (state.streaming && !pending.sawStreaming) pending.lastProgressAt = Date.now();
        const errorActive = monitorWaiting(state);
        attentionDesktop();
        if (state.streaming) {
            pending.sawStreaming = true;
            pending.stoppedAt = null;
            pending.quietAt = now;
            pending.signature = state.signature;
            return;
        }
        if (errorActive) return;

        if (state.signature !== pending.signature || state.actions !== pending.actions) {
            pending.signature = state.signature;
            pending.actions = state.actions;
            pending.quietAt = now;
            pending.stoppedAt = null;
        }
        if (!state.hasActions) pending.sawMissingActions = true;
        const changed = state.signature !== pending.baseline || (pending.reason === 'regenerate' &&
            (state.actions !== pending.baselineActions || pending.sawMissingActions));
        const ready = pending.sawStreaming ? (state.hasActions || state.hasContent) :
            (state.hasActions && changed);
        const freshResult = !pending.resumeBaseline || state.signature !== pending.resumeBaseline.signature ||
            state.actions !== pending.resumeBaseline.actions;
        if (!ready || !freshResult) {
            pending.stoppedAt = null;
            return;
        }
        if (pending.stoppedAt === null) pending.stoppedAt = now;
        if (now - pending.stoppedAt >= GRACE_MS && now - pending.quietAt >= QUIET_MS) {
            pending = null;
            notify();
        }
    }

    function scheduleCheck() {
        if (scheduled === null && !disposed) scheduled = setTimeout(check, 60);
    }

    function composerFor(target) {
        return target instanceof Element ? target.closest(COMPOSER_SELECTOR) : null;
    }

    function testInFiveSeconds(kind = 'done') {
        if (!Object.hasOwn(ICONS, kind)) kind = 'done';
        clearTimeout(testTimer);
        restoreIcon();
        testTimer = setTimeout(() => { testTimer = null; notify(kind, '5秒テスト'); }, 5000);
        console.info('[ChatGPT Response Favicon] 約5秒後にテスト。今、別タブへ移動してください。');
    }

    function diagnostics() {
        const state = snapshot();
        return {
            version: VERSION, layout: state.layout, visibility: document.visibilityState,
            generating: state.streaming, waiting: Boolean(pending),
            sawGenerating: Boolean(pending?.sawStreaming),
            latestAnswerHasCopy: state.hasCopy, assistantTurns: state.assistantCount,
            notified, notification: noticeKind || 'none', originalIcons: nativeIcons().length,
            stallMinutes: STALL_MINUTES,
            minutesWithoutProgress: pending ? Math.max(0, Math.floor((Date.now() - pending.lastProgressAt) / 60000)) : null,
            currentError: pending?.currentError || '', lastNotification: lastNotice?.kind || 'none',
            lastReason: lastNotice?.reason || '',
            desktopEnabled: preference('desktop'), desktopAPI: typeof GM_notification === 'function',
            lastDesktopStatus: desktopLast?.status || 'none', lastDesktopKind: desktopLast?.kind || 'none',
            usagePage: isUsagePage(), usageStatus: usageLastSnapshot.status
        };
    }

    function showDiagnostics() {
        const info = diagnostics();
        console.table(info);
        alert(`ChatGPT Response Favicon ${VERSION}\n` +
            `画面: ${info.layout}\n生成中: ${info.generating}\n回答待機: ${info.waiting}\n` +
            `最新回答のコピー操作: ${info.latestAnswerHasCopy}\n` +
            `回答ターン数: ${info.assistantTurns}\n通知: ${info.notification}\n` +
            `進捗更新なし: ${info.minutesWithoutProgress ?? '-'}分 / ${STALL_MINUTES}分\n` +
            `エラー: ${info.currentError || 'なし'}\n直近の通知理由: ${info.lastReason || 'なし'}\n` +
            `デスクトップ通知: ${info.desktopEnabled ? 'ON' : 'OFF'} / API: ${info.desktopAPI}\n` +
            `直近の通知処理: ${info.lastDesktopStatus}\n使用状況の判定: ${info.usageStatus}\n` +
            `タブ表示: ${info.visibility}`);
    }

    const headObserver = new MutationObserver(records => {
        if (notified) syncNotificationIcon(records);
        else if (nativeIcons().some(link => link.getAttribute('href'))) {
            document.getElementById(RESTORE_ID)?.remove();
        }
    });
    const bodyObserver = new MutationObserver(scheduleCheck);

    // 旧版が付けた復元用属性が残っている場合だけ取り除く。
    for (const link of nativeIcons()) {
        const legacy = link.getAttribute('data-chatgpt-original-favicon');
        if (legacy !== null) {
            setAttr(link, 'href', legacy === '__NONE__' ? null : legacy);
            link.removeAttribute('data-chatgpt-original-favicon');
        }
        if (link.getAttribute('href') && !isOurIcon(link.getAttribute('href'))) lastOriginal = attrsOf(link);
    }
    document.getElementById(ICON_ID)?.remove();
    document.getElementById(RESTORE_ID)?.remove();
    headObserver.observe(document.head, HEAD_OPTIONS);
    bodyObserver.observe(document.body, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['data-testid', 'data-turn', 'data-message-author-role',
            'data-is-streaming', 'aria-label', 'title', 'class', 'hidden', 'disabled', 'aria-disabled', 'contenteditable', 'role', 'aria-live', 'data-state', 'data-status', 'aria-valuenow']
    });

    document.addEventListener('submit', event => {
        if (event.target instanceof Element && event.target.matches('form') &&
            event.target.querySelector(COMPOSER_SELECTOR)) arm('submit');
    }, { capture: true, signal: events.signal });
    document.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest('button');
        if (!button) return;
        if (isStopButton(button)) { if (pending) pending.cancelled = true; return; }
        if (!enabled(button)) return;
        if (isSendButton(button)) arm('send');
        else if (button.matches(REGENERATE_SELECTOR)) arm('regenerate', snapshot(), true);
        else if (pending && /^(?:Retry|Try again|再試行|やり直す|もう一度試す)$/i.test(controlLabel(button))) arm('retry', snapshot(), true);
    }, { capture: true, signal: events.signal });
    document.addEventListener('keydown', event => {
        if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey) {
            if (event.code === 'KeyT') { event.preventDefault(); testInFiveSeconds(); return; }
            if (event.code === 'KeyW') { event.preventDefault(); testInFiveSeconds('stalled'); return; }
            if (event.code === 'KeyE') { event.preventDefault(); testInFiveSeconds('error'); return; }
            if (event.code === 'KeyN') { event.preventDefault(); testDesktopInFiveSeconds(); return; }
            if (event.code === 'KeyU') { event.preventDefault(); showUsageDiagnostics(); return; }
            if (event.code === 'KeyD') { event.preventDefault(); showDiagnostics(); return; }
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing &&
            event.keyCode !== 229 && composerFor(event.target)) {
            const editor = composerFor(event.target);
            if (editor && String(editor.value ?? editor.textContent).trim()) arm('enter');
        }
        acknowledge();
    }, { capture: true, signal: events.signal });
    document.addEventListener('visibilitychange', () => { acknowledge(); scheduleCheck(); }, { signal: events.signal });
    window.addEventListener('focus', () => { acknowledge(); scheduleCheck(); }, { signal: events.signal });
    window.addEventListener('pageshow', scheduleCheck, { signal: events.signal });
    window.addEventListener('online', scheduleCheck, { signal: events.signal });
    window.addEventListener('offline', scheduleCheck, { signal: events.signal });
    document.addEventListener('pointerdown', acknowledge, { capture: true, signal: events.signal });

    if (typeof GM_registerMenuCommand === 'function') {
        menuIds.push(GM_registerMenuCommand('約5秒後に完了アイコンをテスト', () => testInFiveSeconds()));
        menuIds.push(GM_registerMenuCommand('約5秒後に停滞警告をテスト', () => testInFiveSeconds('stalled')));
        menuIds.push(GM_registerMenuCommand('約5秒後にエラー警告をテスト', () => testInFiveSeconds('error')));
        menuIds.push(GM_registerMenuCommand('通知アイコンを解除', restoreIcon));
        menuIds.push(GM_registerMenuCommand('診断情報を表示', showDiagnostics));
        menuIds.push(GM_registerMenuCommand('約5秒後にデスクトップ通知をテスト', testDesktopInFiveSeconds));
        menuIds.push(GM_registerMenuCommand('デスクトップ通知をON/OFFに切替', () => togglePreference('desktop')));
        menuIds.push(GM_registerMenuCommand('途中経過の通知をON/OFFに切替', () => togglePreference('progress')));
        menuIds.push(GM_registerMenuCommand('利用枠の回復通知をON/OFFに切替', () => togglePreference('usage')));
        menuIds.push(GM_registerMenuCommand('使用状況の自動更新をON/OFFに切替', () => togglePreference('usageReload')));
        menuIds.push(GM_registerMenuCommand('利用上限の診断を表示・コピー', showUsageDiagnostics));
    }
    const poll = setInterval(check, POLL_MS);
    window[INSTANCE_KEY] = {
        version: VERSION, inspect: diagnostics, testInFiveSeconds,
        testDesktopInFiveSeconds, inspectUsage: usageDiagnostics,
        dispose() {
            disposed = true;
            events.abort();
            clearInterval(poll);
            clearTimeout(scheduled);
            clearTimeout(testTimer);
            clearTimeout(desktopTestTimer);
            restoreIcon();
            clearTimeout(refreshTimer);
            document.getElementById(RESTORE_ID)?.remove();
            headObserver.disconnect();
            bodyObserver.disconnect();
            if (typeof GM_unregisterMenuCommand === 'function') menuIds.forEach(GM_unregisterMenuCommand);
            delete window[INSTANCE_KEY];
        }
    };
    check();
})();
