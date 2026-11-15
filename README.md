# ChatGPT Response Notification

- Concept, Direction & Product Ownership: Satsuki Thyme
- AI-assisted Engineering: ChatGPT by OpenAI

## 導入・更新

1. [Tampermonkey](https://www.tampermonkey.net/index.php)を使用する。
2. 既存の「ChatGPT Response Favicon」のコードを`ancester/chatgpt-response-favicon.user.js`（v1.5.4）で更新する。有効な本体は1本にする。
3. 未送信入力を保存してから対象タブを再読み込みし、Alt + Shift + Dで1.5.4を確認する。

今回の作業領域版は前回配布した1.5.4と同じコード。導入済みの1.5.4を再インストールする必要はない。既存のスクリプト名・namespace・設定キーは互換性のため保持しており、正式な改称とv0.1.0系列への移行は未実施。

## 確認済みの動作と制限

- 2026-11-13、利用者からChat・Workの正常動作を確認したと報告された。
- 同じ報告で、Chromeの「常にアクティブにするサイト」にchatgpt.comを登録すると、折りたたんだタブグループでも通知が届くことが確認された。
- 利用上限の回復通知は使用状況ページを開いた時に届き、それまでは届かない。非表示のまま回復を知る要件は未達。
- 凍結・破棄されたページ、ブラウザ終了中、PCスリープ中の通知は保証しない。承認待ち通知や全条件の受入は別途確認が必要。

旧READMEの「折りたたみグループでは動かない」という一律の記述を、利用者が確認した条件付きの動作へ訂正した。

## 回復通知遅延の診断候補（1.5.6）

1.5.5の診断JSONが中央省略される問題を修正し、全文を選択できる画面を追加した。候補は`ancester/chatgpt-response-favicon-v1.5.6.user.js`。既存スクリプトへ入れ替え、[採取手順](ancester/USAGE_DIAGNOSTICS-v1.5.6.md)に従って、まず同じ使用状況タブの履歴を全文でコピーする。

構文検査と模擬155件合格。実ブラウザ試験は環境制限で起動せず未実施。Windows上の全文コピーと回復通知遅延の解消は未確認。版番号のない通常配布物は1.5.4のまま。保存結果は`SAVE_VERIFICATION_V1_5_6_DIAGNOSTIC_2026-11-15.json`。

## 開発状況

2026-11-14、構文検査と模擬DOM試験129/129に合格。OS通知の実測とは区別する。GitHub反映・公開は未実施。

- [使い方と制限](ancester/README.md)
- [要件別受入記録・次の診断](ancester/ACCEPTANCE-v1.5.4.md)
- [検証記録](ancester/TESTING.md)
- [工程表](PROCESS_CHART.md)
- [保存検証](SAVE_VERIFICATION_V1_5_4_2026-11-14.json)
