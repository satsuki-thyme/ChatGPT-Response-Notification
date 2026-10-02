// ==UserScript==
// @name         ChatGPT Response Favicon
// @namespace    https://chatgpt.com/
// @version      1.1.0
// @description  ChatGPTの回答完了時にfaviconを変更し、タブを開いたら元に戻す
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const POLL_INTERVAL = 250;
    const COMPLETION_GRACE_MS = 800;
    const CUSTOM_FAVICON_ID = 'chatgpt-response-favicon';

    const DONE_FAVICON = svgToDataUri(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="30" fill="#16a34a"/>
            <path
                d="M18 33 L28 43 L47 22"
                fill="none"
                stroke="white"
                stroke-width="7"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    `);

    let armed = false;
    let sawGenerating = false;
    let stopDisappearedAt = null;
    let notified = false;

    let previousUserCount = countUserTurns();
    let baselineAssistantCount = countAssistantTurns();

    function svgToDataUri(svg) {
        return 'data:image/svg+xml;charset=utf-8,' +
            encodeURIComponent(svg.trim());
    }

    function countUserTurns() {
        return document.querySelectorAll(
            'section[data-turn="user"], [data-message-author-role="user"]'
        ).length;
    }

    function countAssistantTurns() {
        return document.querySelectorAll(
            'section[data-turn="assistant"], [data-message-author-role="assistant"]'
        ).length;
    }

    function isVisible(element) {
        if (!element) {
            return false;
        }

        const style = getComputedStyle(element);

        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            element.getClientRects().length > 0
        );
    }

    /**
     * ChatGPTの「回答生成停止」ボタンだけを見る。
     *
     * aria-label*=Stop のような広い検索は使わない。
     * 音声入力の Stop dictation 等を誤検出するため。
     */
    function isGenerating() {
        const selectors = [
            'button[data-testid="stop-button"]',
            'form[data-chatgpt-composer] button[aria-label="Stop"]',
            'form[data-chatgpt-composer] button[aria-label="Stop streaming"]',
            'form[data-chatgpt-composer] button[aria-label="生成を停止"]',
            'form[data-chatgpt-composer] button[aria-label="ストリーミングを停止"]'
        ];

        for (const selector of selectors) {
            for (const element of document.querySelectorAll(selector)) {
                if (isVisible(element)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * 最新のAssistantメッセージに「コピー」操作が出現しているか。
     * 回答完了の補助判定として使用。
     */
    function latestAssistantLooksComplete() {
        const turns = [
            ...document.querySelectorAll(
                'section[data-turn="assistant"], [data-message-author-role="assistant"]'
            )
        ];

        const last = turns.at(-1);

        if (!last) {
            return false;
        }

        return Boolean(
            last.querySelector(
                'button[data-testid="copy-turn-action-button"]'
            )
        );
    }

    function getFaviconLinks() {
        return [
            ...document.head.querySelectorAll(
                'link[rel~="icon"], link[rel*="icon"]'
            )
        ].filter(link => link.id !== CUSTOM_FAVICON_ID);
    }

    /**
     * 現在のfaviconを保存して緑チェックへ変更。
     */
    function applyDoneFavicon() {
        for (const link of getFaviconLinks()) {
            if (!link.hasAttribute('data-chatgpt-original-favicon')) {
                const original = link.getAttribute('href');

                link.setAttribute(
                    'data-chatgpt-original-favicon',
                    original === null ? '__NONE__' : original
                );
            }

            link.setAttribute('href', DONE_FAVICON);
        }

        let custom = document.getElementById(CUSTOM_FAVICON_ID);

        if (!custom) {
            custom = document.createElement('link');
            custom.id = CUSTOM_FAVICON_ID;
            custom.rel = 'icon';
            custom.type = 'image/svg+xml';
            document.head.appendChild(custom);
        }

        custom.href = DONE_FAVICON;
    }

    /**
     * ChatGPT本来のfaviconへ明示的に復元。
     */
    function restoreFavicon() {
        const custom = document.getElementById(CUSTOM_FAVICON_ID);

        if (custom) {
            custom.remove();
        }

        for (const link of getFaviconLinks()) {
            const original = link.getAttribute(
                'data-chatgpt-original-favicon'
            );

            if (original === null) {
                continue;
            }

            if (original === '__NONE__') {
                link.removeAttribute('href');
            } else {
                link.setAttribute('href', original);
            }

            link.removeAttribute('data-chatgpt-original-favicon');
        }

        notified = false;
    }

    /**
     * 回答完了通知。
     *
     * すでにそのChatGPTタブを見ている場合には通知不要。
     */
    function notifyCompleted() {
        if (
            document.visibilityState === 'visible' &&
            document.hasFocus()
        ) {
            restoreFavicon();
            return;
        }

        notified = true;
        applyDoneFavicon();
    }

    function armForNewResponse() {
        armed = true;
        sawGenerating = false;
        stopDisappearedAt = null;
        baselineAssistantCount = countAssistantTurns();

        restoreFavicon();
    }

    function finishResponse() {
        if (!armed) {
            return;
        }

        armed = false;
        sawGenerating = false;
        stopDisappearedAt = null;

        notifyCompleted();
    }

    function checkState() {
        const userCount = countUserTurns();

        /*
         * 新しいユーザーメッセージが追加されたら、
         * 次のAssistant回答を待つ。
         */
        if (userCount > previousUserCount) {
            armForNewResponse();
        }

        previousUserCount = userCount;

        if (!armed) {
            return;
        }

        const generating = isGenerating();

        /*
         * Stopボタンを一度でも確認できれば、
         * 「生成開始」を確実に観測したとみなす。
         */
        if (generating) {
            sawGenerating = true;
            stopDisappearedAt = null;
            return;
        }

        /*
         * Stopボタン消滅直後はDOM更新の瞬断かもしれないので
         * 少し待ってから完了扱いする。
         */
        if (sawGenerating) {
            if (stopDisappearedAt === null) {
                stopDisappearedAt = performance.now();
                return;
            }

            if (
                performance.now() - stopDisappearedAt >=
                COMPLETION_GRACE_MS
            ) {
                finishResponse();
            }

            return;
        }

        /*
         * 非常に短い回答などでStopボタンを見逃した場合の保険。
         *
         * Assistantターンが増えて、コピー操作まで現れたら
         * 回答完了とみなす。
         */
        const assistantCount = countAssistantTurns();

        if (
            assistantCount > baselineAssistantCount &&
            latestAssistantLooksComplete()
        ) {
            finishResponse();
        }
    }

    /**
     * ChatGPTタブを見たら通知解除。
     */
    function acknowledge() {
        if (!notified) {
            return;
        }

        if (
            document.visibilityState === 'visible' &&
            document.hasFocus()
        ) {
            restoreFavicon();
        }
    }

    document.addEventListener('visibilitychange', acknowledge);
    window.addEventListener('focus', acknowledge);

    // 念のため実際の操作でも解除する。
    window.addEventListener('pointerdown', acknowledge, true);
    window.addEventListener('keydown', acknowledge, true);

    /*
     * ChatGPTがhead内のfaviconを書き換えた場合でも、
     * 通知中なら緑チェックを維持する。
     */
    const headObserver = new MutationObserver(() => {
        if (notified) {
            applyDoneFavicon();
        }
    });

    headObserver.observe(document.head, {
        childList: true
    });

    setInterval(checkState, POLL_INTERVAL);
})();