# 1.5.7実機診断の照合と1.5.8修正

記録日: 2026-11-18 JST。工程5。対象はDropbox作業領域の版番号付き候補。

## 結論

今回の非表示中の更新停止は、利用枠を認識した状態で、入力内容なしと判定されたtext入力にdocument.activeElementが残り、input-focus保護に当たったことが原因。文書全体のdocumentFocusはfalse、入力は利用枠のmain範囲外だった。フォーカスを残したサイト側の仕組みや入力欄の用途は未確認だが、停止させた自作スクリプトの分岐は特定できた。

1.5.7のhasContentはtrim後の判定なので、厳密な空文字か空白文字だけかは区別できない。1.5.8では厳密な空文字だけを例外とし、空白文字は保護する。hasRawContentを真偽値として追加し、入力内容は保存しない。

前回1.5.6の「非表示で長く利用枠を認識できない」現象は、今回の実行では再現していない。再読み込み後2,420 msで非表示のまま認識した。この別現象の根本原因や、実際の利用上限解除通知の到達まで解決したとはしない。

## 原資料

- 受領JSON: 39,213バイト、20イベント、全イベントscriptVersion=1.5.7。version=1.5.7、loaded/saved。
- SHA-256: `e450c0e5e94d609d17030cf6b19b32d6123adf93078d7967de0f39f9d89322f5`。
- 元のバイト列をZIP内evidence/usage-diagnostic-v1.5.7-received-2026-11-18.jsonへ保全。添付原本は変更しない。
- ソースはDropboxから再取得し、前回保存済み1.5.7とバイト一致を確認。SHA-256: `509fb27aea6c1bca4a949519ddc2c00c204dd4469e6b6b4c802df548cc2b1420`。
- 現在値60%/61%、最大監視間隔60,004 ms、freeze/resume/interruptedAt・観測空白はnull、wasDiscarded=false。ブラウザ等の個別バージョンはJSONにない。

## 時系列

時刻はすべて2026-11-18、Asia/Tokyo。番号は0始まりのイベント配列。

| 番号 | 時刻 | 観測 |
| --- | --- | --- |
| 3 | 03:33:52.144 | hidden、recognized、72%/63%、フォーカスはbutton、抑止なし |
| 7〜8 | 03:34:49.587〜49.806 | hiddenでreload-request→pagehide |
| 9〜10 | 03:34:51.182〜51.204 | 新実行、unknown、scope=body、既知見出し0 |
| 11 | 03:34:53.602 | hiddenのままrecognized、70%/63%。text入力にフォーカス、hasContent=false、documentFocus=false、inScope=false。input-focusで抑止 |
| 12〜17 | 03:35:08.604〜03:37:26.380 | 同じinput-focus抑止が続く。見出し4、対象2、除外2。rowsは2枠を認識 |
| 18 | 03:37:27.066 | visibleへ移行 |
| 19 | 03:37:27.400 | 60%/61%へ変化、フォーカス先は同じ種類 |

未認識から認識まで2,420 ms。フォーカス抑止の最初と最後の標本間は152,778 ms（2分32.778秒）、最後の標本は更新予定を95,213 ms過ぎている。表示から値が変わった標本までは334 ms。標本間の全瞬間を観測したものではない。

見出し2件の除外は残る2枠の認識を妨げていない。非表示更新後に72%から70%へ変化したことは観測できるが、常にサーバーの最新値を取得できたという保証ではない。現行ページが表示を契機に更新する内部実装も推測で確定しない。

blockedBeforeは空、全記録で枠はavailable、回復要求はない。今回は実上限の解除試験ではない。

## 修正と根拠

自動更新の例外は、/settings/usageのoverview、hidden、文書フォーカスなし、可視のmain/dialogの外にあるtext入力、値が厳密に空、contenteditable内ではない、観測中のIME変換なし、という条件を満たす場合だけ。その他の入力が1文字でもあれば空白文字を含めて更新を抑止する。フォーカスの移動や解除は行わない。

compositionstart、isComposing付きbeforeinput、compositionendを既存のAbortControllerで監視し、変換中はinput-compositionで保護。保存するのはinputCompositionの真偽値だけ。通知条件・利用枠の解析・回復確認時間・重複防止・更新間隔・権限・既存設定キーは変更しない。

1.5.7で同じ条件の更新停止を模擬再現し、1.5.8で連続更新と、再読み込み後も続く更新・回復要求を検証した。入力保護、IME、会話ルート、未認識、オフライン、保存不可、生成中等を含む追加17件と既存168件の計185件が合格。既存の入力中試験1件は、空欄を操作中とする旧前提を本文ありへ具体化した。空欄の旧版再現と新版の変更は追加試験で別途比較した。

Windows/Tampermonkeyの実動作と実通知は未確認。前回Chromium起動を阻止した実行環境の制限を回避する試行はしていない。

## 次の実機確認

[USAGE_FIX-v1.5.8.md](USAGE_FIX-v1.5.8.md)のとおり既存スクリプトを更新し、使用状況タブを別タブの背後で約4分置いて診断全文を採る。1.5.8の異なるrunStartedAtにまたがる更新要求が2回以上続くこと、枠の認識、入力保護を照合する。上限の意図的な消費は不要。実回復通知は自然に制限が解除される機会に別途確認する。

## 公式資料

- [HTML Standard — Focus management APIs](https://html.spec.whatwg.org/multipage/interaction.html#focus-management-apis): activeElementと文書全体のhasFocusは別の観測値。
- [UI Events — Composition Events](https://w3c.github.io/uievents/#events-compositionevents): 変換開始・終了、isComposingの意味。

参照日2026-11-18 JST。仕様の一般的説明と利用者の実測は区別する。
