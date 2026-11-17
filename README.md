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

## 自動更新停止の修正候補（1.5.8）

1.5.7実測で、利用枠を読めていても、範囲外の空欄扱いtext入力にフォーカスが残るため更新が止まることを確認。1.5.8は文書フォーカスなし・厳密に空のtext入力だけに限定して修正した。空白文字を含む入力とIME変換中は保護する。

導入物はancester/chatgpt-response-favicon-v1.5.8.user.js。[確認手順](ancester/USAGE_FIX-v1.5.8.md)に沿い、約4分の非表示後の診断で連続更新を確認する。[実測の照合](ancester/DIAGNOSIS-v1.5.7-2026-11-18.md)も参照。

構文検査と模擬185/185件合格。Windows実機と実回復通知は未確認。前回の長い利用枠未認識は別課題として残る。通常配布物は1.5.4。保存結果はSAVE_VERIFICATION_V1_5_8_FIX_2026-11-18.json。

## 開発状況

2026-11-14、構文検査と模擬DOM試験129/129に合格。OS通知の実測とは区別する。GitHub反映・公開は未実施。

- [使い方と制限](ancester/README.md)
- [要件別受入記録・次の診断](ancester/ACCEPTANCE-v1.5.4.md)
- [検証記録](ancester/TESTING.md)
- [工程表](PROCESS_CHART.md)
- [保存検証](SAVE_VERIFICATION_V1_5_4_2026-11-14.json)
