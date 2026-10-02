// ==UserScript==
// @name         ChatGPT Response Favicon
// @namespace    https://chatgpt.com/
// @version      1.3.0
// @description  Chat/Workの回答完了を緑チェックで通知。タブへ戻ると復元。5秒テスト・診断付き。
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '1.3.0';
    const INSTANCE_KEY = '__chatgptResponseFaviconV2';
    const ICON_ID = 'chatgpt-response-favicon';
    const RESTORE_ID = `${ICON_ID}-restore`;
    const GRACE_MS = 1500;
    const QUIET_MS = 1000;
    const POLL_MS = 500;
    const WAIT_TIMEOUT_MS = 600000; // 生成中にはタイムアウトしない。
    const ATTRS = ['href', 'type', 'sizes'];
    const DONE_ICON = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
        '<circle cx="32" cy="32" r="30" fill="#16a34a"/>' +
        '<path d="M18 33 28 43 47 22" fill="none" stroke="white" ' +
        'stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    );
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
    const COMPOSER_SELECTOR = [
        '#prompt-textarea', '[data-testid="composer-input"]',
        '.ProseMirror[role="textbox"][contenteditable="true"][aria-label*="Work"]'
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
    const WORK_EDITOR_SELECTOR = '.ProseMirror[role="textbox"][aria-label*="Work"]';
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
    let pending = null;
    let lastOriginal = null;
    let scheduled = null;
    let testTimer = null;
    let refreshTimer = null;
    let route = location.pathname;
    let disposed = false;

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

    function syncDoneIcon(records = []) {
        if (!notified) return;
        const desired = { href: DONE_ICON, type: 'image/svg+xml', sizes: 'any' };

        // サイトが通知中に元アイコンを更新した場合、その新しい値を復元先にする。
        for (const record of records) {
            const original = originals.get(record.target);
            if (record.type !== 'attributes' || !original || !ATTRS.includes(record.attributeName)) continue;
            const value = record.target.getAttribute(record.attributeName);
            if (value !== desired[record.attributeName]) {
                original[record.attributeName] = value;
                if (original.href && original.href !== DONE_ICON) lastOriginal = { ...original };
            }
        }

        changeHead(() => {
            clearTimeout(refreshTimer);
            document.getElementById(RESTORE_ID)?.remove();
            for (const link of nativeIcons()) {
                if (!originals.has(link)) {
                    const original = attrsOf(link);
                    // サイトが変更済み要素を複製した場合、緑アイコンを元画像にしない。
                    if (original.href === DONE_ICON && lastOriginal) Object.assign(original, lastOriginal);
                    originals.set(link, original);
                    if (original.href && original.href !== DONE_ICON) lastOriginal = { ...original };
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
            if (!fallback?.href || fallback.href === DONE_ICON) return;

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

    function notify() {
        if (document.visibilityState === 'visible') { restoreIcon(); return; }
        notified = true;
        syncDoneIcon();
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
        if (!document.querySelector(WORK_EDITOR_SELECTOR) || !nearComposer(button)) return false;
        return /^(?:Stop(?: generating| streaming| response| task)?|停止(?:する)?|(?:生成|回答|処理|タスク|ストリーミング)を停止(?:する)?)$/i.test(controlLabel(button));
    }

    function isSendButton(button) {
        if (button.matches(SEND_SELECTOR)) return true;
        return nearComposer(button) &&
            /^(?:Send(?: prompt| message)?|Submit|(?:メッセージ|プロンプト)?(?:を)?送信(?:する)?)$/i.test(controlLabel(button));
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
        const streaming = [...document.querySelectorAll('button')].some(button => isVisible(button) && isStopButton(button)) ||
            Boolean(last?.matches('[data-is-streaming="true"]') || message?.matches('[data-is-streaming="true"]'));
        return {
            key, hasCopy: Boolean(copy), hasActions: Boolean(copy || regenerate), streaming,
            hasContent: text.trim().length > 0,
            signature: `${key}|${text.length}|${text.slice(-512)}`,
            actions: `${nodeKey(copy)}|${nodeKey(regenerate)}`,
            assistantCount: assistantTurns.length,
            layout: document.querySelector(WORK_EDITOR_SELECTOR) ? 'Work' : assistantTurns.length ? 'Chat' : 'unknown'
        };
    }

    function arm(reason, state = snapshot()) {
        if (pending && !pending.cancelled) return;
        restoreIcon();
        clearTimeout(testTimer);
        testTimer = null;
        pending = {
            reason, baseline: state.signature, baselineActions: state.actions, started: performance.now(),
            sawStreaming: false, stoppedAt: null, quietAt: performance.now(),
            signature: state.signature, sawMissingActions: false, cancelled: false
        };
    }

    function check() {
        clearTimeout(scheduled);
        scheduled = null;
        if (disposed) return;
        acknowledge();
        const state = snapshot();
        const now = performance.now();
        if (location.pathname !== route) {
            // 最初の送信で新規チャットにIDが付く遷移は、待機を引き継ぐ。
            const newChat = pending && !/\/(?:c|work)\/[^/]+/.test(route) && /\/(?:c|work)\/[^/]+/.test(location.pathname) &&
                now - pending.started < 15000;
            if (!newChat) { pending = null; restoreIcon(); }
            route = location.pathname;
        }

        // 質問の件数に依存しない。再生成や読み込み時に進行中の回答も検出する。
        if (state.streaming) {
            if (!pending) arm('generation', state);
            pending.sawStreaming = true;
            pending.stoppedAt = null;
            pending.quietAt = now;
            pending.signature = state.signature;
            return;
        }
        if (!pending) return;
        if (pending.cancelled) { pending = null; return; }

        if (state.signature !== pending.signature) {
            pending.signature = state.signature;
            pending.quietAt = now;
        }
        if (!state.hasActions) pending.sawMissingActions = true;
        const changed = state.signature !== pending.baseline || (pending.reason === 'regenerate' &&
            (state.actions !== pending.baselineActions || pending.sawMissingActions));
        const ready = pending.sawStreaming ? (state.hasActions || state.hasContent) :
            (state.hasActions && changed);
        if (!ready) {
            pending.stoppedAt = null;
            if (now - pending.started >= WAIT_TIMEOUT_MS) pending = null;
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

    function testInFiveSeconds() {
        clearTimeout(testTimer);
        restoreIcon();
        testTimer = setTimeout(() => { testTimer = null; notify(); }, 5000);
        console.info('[ChatGPT Response Favicon] 約5秒後にテスト。今、別タブへ移動してください。');
    }

    function diagnostics() {
        const state = snapshot();
        return {
            version: VERSION, layout: state.layout, visibility: document.visibilityState,
            generating: state.streaming, waiting: Boolean(pending),
            sawGenerating: Boolean(pending?.sawStreaming),
            latestAnswerHasCopy: state.hasCopy, assistantTurns: state.assistantCount,
            notified, originalIcons: nativeIcons().length
        };
    }

    function showDiagnostics() {
        const info = diagnostics();
        console.table(info);
        alert(`ChatGPT Response Favicon ${VERSION}\n` +
            `画面: ${info.layout}\n生成中: ${info.generating}\n回答待機: ${info.waiting}\n` +
            `最新回答のコピー操作: ${info.latestAnswerHasCopy}\n` +
            `回答ターン数: ${info.assistantTurns}\n完了通知: ${info.notified}\n` +
            `タブ表示: ${info.visibility}`);
    }

    const headObserver = new MutationObserver(records => {
        if (notified) syncDoneIcon(records);
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
        if (link.getAttribute('href') && link.getAttribute('href') !== DONE_ICON) lastOriginal = attrsOf(link);
    }
    document.getElementById(ICON_ID)?.remove();
    document.getElementById(RESTORE_ID)?.remove();
    headObserver.observe(document.head, HEAD_OPTIONS);
    bodyObserver.observe(document.body, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['data-testid', 'data-turn', 'data-message-author-role',
            'data-is-streaming', 'aria-label', 'title', 'class', 'hidden', 'disabled', 'aria-disabled', 'contenteditable']
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
        else if (button.matches(REGENERATE_SELECTOR)) arm('regenerate');
    }, { capture: true, signal: events.signal });
    document.addEventListener('keydown', event => {
        if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey) {
            if (event.code === 'KeyT') { event.preventDefault(); testInFiveSeconds(); return; }
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
    document.addEventListener('pointerdown', acknowledge, { capture: true, signal: events.signal });

    if (typeof GM_registerMenuCommand === 'function') {
        menuIds.push(GM_registerMenuCommand('約5秒後に完了アイコンをテスト', testInFiveSeconds));
        menuIds.push(GM_registerMenuCommand('完了アイコンを解除', restoreIcon));
        menuIds.push(GM_registerMenuCommand('診断情報を表示', showDiagnostics));
    }
    const poll = setInterval(check, POLL_MS);
    window[INSTANCE_KEY] = {
        version: VERSION, inspect: diagnostics, testInFiveSeconds,
        dispose() {
            disposed = true;
            events.abort();
            clearInterval(poll);
            clearTimeout(scheduled);
            clearTimeout(testTimer);
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