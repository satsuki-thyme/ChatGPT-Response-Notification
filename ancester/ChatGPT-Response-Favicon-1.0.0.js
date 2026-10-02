// ==UserScript==
// @name         ChatGPT Response Favicon
// @namespace    https://chatgpt.com/
// @version      1.0.0
// @description  ChatGPTの回答完了時にfaviconを変更し、タブを開いたら元に戻す
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const CUSTOM_FAVICON_ID = 'chatgpt-response-favicon';

    // 回答完了時に表示する favicon。
    // 緑色の丸に白いチェック。
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

    let wasGenerating = false;
    let generationObserved = false;
    let done = false;

    /**
     * SVG文字列をfavicon用data URIに変換する。
     */
    function svgToDataUri(svg) {
        return 'data:image/svg+xml;charset=utf-8,' +
            encodeURIComponent(svg.trim());
    }

    /**
     * ChatGPTが現在回答生成中か判定する。
     *
     * ChatGPTのDOM変更にある程度耐えられるように、
     * 複数の候補を確認する。
     */
    function isGenerating() {
        const selectors = [
            'button[data-testid="stop-button"]',
            'button[aria-label="Stop streaming"]',
            'button[aria-label*="Stop"]',
            'button[aria-label*="stop"]',
            'button[aria-label*="停止"]',
            'button[title*="Stop"]',
            'button[title*="stop"]',
            'button[title*="停止"]'
        ];

        return selectors.some(selector => {
            try {
                return document.querySelector(selector) !== null;
            } catch {
                return false;
            }
        });
    }

    /**
     * 完了通知faviconを表示する。
     */
    function showDoneFavicon() {
        let favicon = document.getElementById(CUSTOM_FAVICON_ID);

        if (!favicon) {
            favicon = document.createElement('link');
            favicon.id = CUSTOM_FAVICON_ID;
            favicon.rel = 'icon';

            // 元のfaviconより後ろに置くことで優先させる。
            document.head.appendChild(favicon);
        }

        favicon.href = DONE_FAVICON;
        done = true;
    }

    /**
     * 通知faviconを外し、ChatGPT本来のfaviconに戻す。
     */
    function restoreFavicon() {
        const favicon = document.getElementById(CUSTOM_FAVICON_ID);

        if (favicon) {
            favicon.remove();
        }

        done = false;
    }

    /**
     * ChatGPTの状態を確認する。
     */
    function checkState() {
        const generating = isGenerating();

        // 回答生成開始
        if (generating && !wasGenerating) {
            generationObserved = true;

            // 新しい質問を始めたら前回の通知を消す。
            restoreFavicon();
        }

        // 「生成中 → 生成終了」を検出
        if (
            wasGenerating &&
            !generating &&
            generationObserved
        ) {
            generationObserved = false;

            // 回答が完了したら通知faviconにする。
            showDoneFavicon();
        }

        wasGenerating = generating;
    }

    /**
     * タブを見たら通知を解除する。
     */
    function acknowledge() {
        if (!document.hidden && done) {
            restoreFavicon();
        }
    }

    // ChatGPTはSPAなので、DOM変更を監視する。
    const observer = new MutationObserver(() => {
        checkState();
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
            'aria-label',
            'title',
            'data-testid'
        ]
    });

    // MutationObserverで拾えないケースへの保険。
    setInterval(checkState, 500);

    // 別タブから戻ってきたら通知解除。
    document.addEventListener('visibilitychange', acknowledge);

    // 同じウィンドウ内でフォーカスが戻った場合にも解除。
    window.addEventListener('focus', acknowledge);

    // 初期状態を取得。
    wasGenerating = isGenerating();

})();