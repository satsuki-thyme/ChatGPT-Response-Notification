# 1.5.6診断全文の照合結果

記録日: 2026-11-16 JST。ChatGPT Response Notification、工程5。

## 結論

非表示中の自動更新を抑止した分岐を2つ特定した。直近は再読み込み後の利用枠未認識（unrecognized）、以前の実行は入力フォーカス（input-focus）。ただし、未認識を起こしたDOM状態とフォーカス先の種類は未採取であり、根本原因と通知遅延の解消は未確定。

1.5.6の全文取得は確認できた。38,309バイト、正しいJSON、48イベント。受領したままのバイト列をZIPのevidence/usage-diagnostic-v1.5.6-received-2026-11-16.jsonに保全した。

- 受領ファイルSHA-256: `fe4f11294fc7fd33244874a52438adfca57f3aff542baf883d3be9b21c5ba68d`
- 照合元1.5.6 SHA-256: `9cc88ab2199e0dcf267ac9f2359e0ebbc42781d87554e306867ea3ef55f40f68`
- 現在値: 5時間枠100%、週間枠91%、recognized、usage-path、loaded/saved、最大監視間隔60,000 ms。freezeAt/resumeAt/interruptedAtと観測空白はnull、wasDiscarded=false。
- タブ、OS、Chrome、Tampermonkeyの個別版や、コピーに使った具体的な操作はこのJSONにはない。

## 観測された時系列

時刻はJSON内のUnixミリ秒をAsia/Tokyoへ変換。イベント番号は配列の0始まり。

| イベント | JST | 観測 |
| --- | --- | --- |
| 0 | 11/15 07:47:09.212 | hidden・recognizedでreload-request |
| 2 | 11/15 07:47:11.146 | 新しいrunStartedAt、hidden、unknown |
| 4〜15 | 11/15 07:47:14.256〜07:56:10.235 | hidden・recognized、input-focus。5時間54%、週間2% |
| 29 | 11/15 14:03:21.106 | visibleでrecovery-result/requested |
| 32 | 11/16 06:36:46.942 | hiddenへ移行、recognized、抑止理由なし。100%/91% |
| 36 | 11/16 06:37:34.170 | hiddenのままreload-request |
| 37〜39 | 11/16 06:37:34.509〜06:37:35.589 | pagehide→新しいrunStartedAtでentered→pageshow。navigationType=reload |
| 38〜45 | 11/16 06:37:35.556〜06:41:10.176 | hidden、unknown、rows=[]、unrecognized。途中の標本も同じ |
| 46 | 11/16 06:41:13.741 | visibleへ移行。直前snapshotはunknown |
| 47 | 11/16 06:41:14.809 | recognized、100%/91% |

直近の最初の未認識記録から最後の非表示標本まで214,620 ms（3分34.620秒）。表示への移行記録から認識した標本まで1,068 ms。以前のinput-focusの最後の標本は更新予定を479,104 ms（7分59.104秒）過ぎている。標本間に未記録の変化がないとまでは保証しない。

更新要求だけで完了と判断せず、pagehideと後続実行・reload種別があることを根拠に再読み込みの進行を確認した。サーバーから利用枠の最新値を受信した時刻までは分からない。

## ソースとの対応

| 観測 | 現行ソースで対応する分岐 | まだ分からないこと |
| --- | --- | --- |
| unrecognized | usageReloadBlockでsnapshot.rows.lengthが0なら以降の自動更新を止める | 使用状況が未生成、選択した範囲の違い、可視性条件、値解析のどれか |
| input-focus | document.activeElementがinput/textarea/select/contenteditable=trueなら更新を止める | 入力欄の種類、中身の有無、空欄に残ったフォーカスか |
| タブ表示後にrecognized | usageSnapshotの実際の戻り値が変化 | 表示でDOM生成・データ取得・配置条件のどれが変わったか |

直近の非表示期間にも監視標本が続いている。「全期間で監視が完全に凍結していた」だけでは説明できない。一方、freezeイベントがないことだけで、ブラウザ・ページ側のあらゆる抑制がなかったとは断定しない。Chromeの一般仕様では凍結中にタイマー等が停止するが、その一般説明を今回の根本原因に置き換えない。

## 回復通知の受入とは分ける

11/15の記録では週間枠が0%→95%→100%→0%と短時間に変化し、再読み込み後に100%が続いてrequestedへ進んでいる。値の変化が実際の上限解除なのか、初期描画等による一時的な表示なのかは未確認。

requestedは通知APIへの要求記録であり、Windowsで表示された証拠ではない。このイベントはvisible時のため、非表示のまま利用者が解除を知れた証拠にもならない。現在のlastDesktop=nullは現在の実行の値であり、以前の要求記録を否定しない。

旧履歴は各イベントの版番号を持たない。外側のversionが1.5.6でも48イベントすべてを1.5.6実行として扱わない。見た目・Esc・実クリップボードの個別試験も、全文受領だけで合格にはしない。

## 今回の実装判断

1.5.7候補で既知見出しの存在・可視性・除外、範囲種別、フォーカス先の型と内容の有無を追加観測する。本文や入力内容は保存しない。各イベントにscriptVersionを追加し、旧履歴の版はnullで保持する。

通知・回復・読取・自動更新の11関数と@name/@namespace/@match/@grantを1.5.6と比較して一致を確認した。未送信入力保護や未認識時の抑止は解除しない。追加観測は履歴を書き込む時だけで、別のタイマーや通信を増やさない。構文検査と模擬168/168に合格。Windowsでの1.5.7の採取は未確認。

実機で新項目が必要なので、[採取手順](USAGE_DIAGNOSTICS-v1.5.7.md)に沿って一度だけ約2分の非表示状態を採る。上限を意図的に消費する必要はない。根拠が揃った分岐から修正する。配布方式の変更が必要になった場合は、利用者への負担と効果を示して別途判断する。

## 公式資料

- [Chrome Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api): hiddenとfrozen、凍結中のタイマー停止の説明。
- [HTML Standard — Focus management APIs](https://html.spec.whatwg.org/multipage/interaction.html#focus-management-apis): activeElementとhasFocusは別の観測値。非アクティブなタブのフォーカス先だけで利用者の操作中を断定しない。

参照日: 2026-11-16 JST。ChatGPTの未公開仕様は根拠にしていない。
