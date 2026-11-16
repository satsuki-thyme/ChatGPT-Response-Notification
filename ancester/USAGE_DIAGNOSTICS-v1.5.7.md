# 1.5.7：利用枠を読み取れない段階と入力フォーカスの診断

作成日: 2026-11-16 JST。工程5の診断候補。通知遅延を解消した版ではない。

## 今回分かったこと

1.5.6の診断全文を取得できた。直近では非表示中の再読み込み後、利用枠の認識が約3分半失敗し、タブ表示から約1秒後に認識した。以前の実行では入力フォーカスが更新を抑止していた。詳しい時系列と未確認範囲は[DIAGNOSIS-v1.5.6-2026-11-16.md](DIAGNOSIS-v1.5.6-2026-11-16.md)。

これまでの履歴には、読み取り対象内に見出しが存在したか、非表示条件で除外されたか、どの種類の入力欄にフォーカスがあったかがない。1.5.7でその情報を補う。再読み込み・通知の判断、未送信入力の保護、識別子・権限・設定は維持する。

## 一度だけ行う採取

1. Tampermonkeyの既存スクリプトを`chatgpt-response-favicon-v1.5.7.user.js`（同内容の`.user.txt`も可）へ入れ替える。本体を重複登録しない。
2. 未送信入力を保存し、前回と同じ使用状況タブを再読み込みする。利用枠が表示されたら別タブへ切り替え、約2分待つ。
3. 使用状況タブへ戻り、Alt + Shift + Uで開く診断の全文をCtrl+Cでコピーして提出する。選択が外れたら「全文を選択」を押す。閉じるボタンまたはEscで終了する。

上限を使い切る操作や確認用の送信は不要。待機中の手動再読み込みも不要。1.5.6以前の記録には新しい診断項目がないため、今回は更新後に一度だけ非表示の状態を採る必要がある。

## 新しい診断項目

現在値の`readerProbe`と、`usageTrace.events[]`・`lastHiddenObservation`内の`readerProbe`を比較する。`scriptVersion`は1.5.7以降に作成した各イベントの版で、古い履歴はnullのままにする。

| 項目 | 意味と読み方 |
| --- | --- |
| `at` / `status` | 追加観測時刻とsampled/failed。失敗の詳細文字列は保存しない |
| `readyState` | 読み込み状態。completeでも利用データ取得完了の証明にはならない |
| `scope` / `scopeVisible` / `scopeBusy` | 現行読取処理が選ぶdialog/main/body、配置上の可視性、範囲自身のaria-busy |
| `inspected` / `truncated` | 追加走査した要素数と上限到達。上限2,000。truncatedなら0件でも不存在を断定しない |
| `labels.known` | 対象範囲に見つかった既知の見出し数。子に同じ見出しを含む親は重複計上しない |
| `labels.excluded` | hiddenまたはaria-hidden=trueを持つ要素・祖先による除外数 |
| `labels.notVisible` | 上の除外以外で、配置・スタイル条件から読み取り対象外になった数 |
| `labels.noBox` / `displayNone` / `visibilityHidden` | notVisibleの内訳。重複するため合計は一致しないことがある。visibilityHiddenはcollapseも含む |
| `labels.eligible` | 見出しの段階では通過できる数。値の形式や祖先探索に成功したことは意味しない |
| `keys` | 許可した利用枠識別子のみ、最大16。表示ラベルや任意文字列は保存しない |
| `documentFocus` | 文書全体のフォーカス。タブのvisibilityとは別の項目 |
| `focus.tag` / `type` / `guardMatch` | document.activeElementの要素・入力型と、現行フォーカス保護条件に該当するか |
| `focus.hasContent` | テキスト欄・編集欄に内容があるかだけ。password/file/select等は未読取りでnull |
| `focus.readOnly` / `disabled` / `visible` / `inScope` | フォーカス先の読み取り専用・無効・配置上の可視性・対象範囲内か |
| `focus.diagnosticDialog` | このスクリプト自身の診断画面にフォーカスがあるか |

追加診断は会話、コード、ナビゲーション、入力欄等の本文を見出し探索から除外し、対象範囲の既知ラベルだけを数える。実際の読取処理との完全なDOM写像ではない。対象範囲外、別フレーム、他のShadow DOM内部の存在・不在は判定できない。数値が不明な場合は推測しない。

通知判定に使うsnapshotと追加観測は別時刻の場合がある。特にvisibilityイベントの直後はsnapshotAtとreaderProbe.atを確認する。追加診断に値が見つかっても、隠れた古い値を回復通知の根拠には使わない。

## 採取後の判断

| 非表示時の追加観測 | 次の調査・修正判断 |
| --- | --- |
| known=0、truncated=false | 選ばれた範囲内に既知の見出しを検出できない。ページ全体の未生成や通信停止とはまだ断定しない |
| known>0、excludedまたはnotVisible>0 | どの除外条件に当たったかを特定し、現在の表示か古い非表示データかを確認する |
| eligible>0、snapshotのrowsなし | 値の形式、カードの範囲、競合検出を次に調べる |
| input-focus、hasContent=false | 空欄フォーカスの保護条件を見直せる候補。ただし即座に保護を解除しない |
| input-focus、hasContent=true/null | 内容保全または未観測の入力がある。自動更新を許可したとは扱わない |

## 負荷・保存・互換性

追加DOM走査は履歴を書き込む状態変化／ライフサイクルイベント、同一状態では既存の約15秒間隔、および利用者が診断を開いた時だけ行う。新しいタイマー・通信・自動送信はない。Chromeによる遅延で実間隔は延びる。

履歴は従来と同じタブのsessionStorage、最大48件・24時間。読戻し時にも固定の列挙値、数、真偽値、許可した枠名だけを採用する。会話本文、入力の中身、DOM/HTML、URL、任意の属性値、アカウント情報は新規保存・外部送信しない。診断処理が失敗しても、通知や利用枠状態の保存は継続する。

1.5.5/1.5.6の履歴を同じキーで読む。通常配布の版番号なしソースとpackage.jsonは1.5.4を維持する。診断を戻す場合は、既存スクリプトのコードを1.5.6、通常運用へ戻す場合は1.5.4へ入れ替えてから未送信入力を保存し、対象タブを再読み込みする。診断履歴の追加項目は旧版で無視される。

## 検証と残る確認

構文検査、既存155件、今回の13件を実行する。結果の正本は同梱VERIFICATION.mdとverification-results-2026-11-16/。合成DOM・時計・通知API・再読み込みでの検証は実機通知の証明ではない。

1.5.6では38,309バイトの完全なJSONを受領した。これにより全文取得は確認できたが、Windows/Tampermonkeyでの具体的なコピー操作・Esc・見た目を一括して合格とはしない。1.5.7の追加項目と非表示中の実際の回復通知は実機未確認。

公式資料: [Chrome Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)、[HTML Standardのfocus API](https://html.spec.whatwg.org/multipage/interaction.html#focus-management-apis)。一般仕様と今回の実測を区別し、ChatGPT側の未公開実装を推定事実にしない。
