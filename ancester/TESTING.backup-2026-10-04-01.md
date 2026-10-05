# 検証メモ — 1.5.0

検証日: 2026-10-03 JST。環境: Node.js v24.19.0 / jsdom 30.1.1。
結果: **92 / 92 PASS**。`node --check` による構文チェックも成功。

## 検証した内容

- 従来の40項目: 完了検出、Work/Chatの入力欄・回答DOM、再生成、停止、タブ復帰、ルート変更、ファビコンの復元と更新。
- 警告20項目: 30分の境界、時計と実際の進捗の区別、停滞からの復旧、エラーの継続・再試行、オフライン、警告色の切り替え。
- 今回追加した32項目: デスクトップ通知の対象・抑制・頻度制限、本文を含めない通知、クリックとテストキー、承認待ち、API障害、利用枠の残量・使用率・日本語・アクセシビリティ値、初期状態・読み込み・矛盾・一時的表示の除外、複数枠、再制限、保存・再読み込み・経路の除外、API失敗時の再試行。

残量0%のバーと「Resets in…」を一緒に表示した場合、予定時刻を回復と誤認する不具合を修正しました。「Limit reset time…」「Limit will be reset…」だけでも回復通知が出ないことを検証しています。

テストではローカルの模擬DOMと、通知API・時刻・タブ表示状態・レイアウト・再読み込みの模擬実装を使います。実OS上での通知表示、Tampermonkey実行環境、ログイン後の実際の使用状況画面への適合はこのテストの対象外です。

## 再実行

展開したフォルダーで、Node.js 24とnpmが利用可能な環境から実行します。

```sh
npm install
npm test
```

`tests/results.json` は配布時の結果です。再実行結果は `tests/favicon-test-results.json` へ出力します。既存の実行結果は同じディレクトリ内で日付と連番を付けてリネームしてから、新しい結果を書きます。

jsdom 30.1.1に固定しています。再読み込み回数の検証に、この版の内部Locationラッパーを使っています。

## 配布コードの照合

`chatgpt-response-favicon.user.js` と別配布の `.user.txt` は同一のUTF-8バイト列です。

SHA-256:

```text
fe786033fe7a52d61e11100bfdf6346cbc52952bae0431c6f05f0e9e15a3387a
```

## 実ブラウザでの確認手順

1. 更新後にChatGPTと使用状況のタブを再読み込みし、Alt + Shift + Dで1.5.0を確認。
   結果: ok
2. Alt + Shift + Nで約5秒後に通知が表示されることを確認。
   結果: ok
3. 会話に短い質問を送り、完了する前に別タブへ移動。完了通知と緑のアイコンを確認。
   結果: ok
4. 使用状況ページのAlt + Shift + Uで `recognized` と対象枠の残量を確認。
   結果: ok
    ``` json
    {
      "version": "1.5.0",
      "page": "usage-overview",
      "status": "recognized",
      "rows": [
        {
          "key": "hours-5",
          "label": "5時間ごとの利用上限",
          "state": "available",
          "remaining": 100
        },
        {
          "key": "weekly",
          "label": "週ごとの利用上限",
          "state": "available",
          "remaining": 68
        }
      ],
      "unknownLabels": [],
      "desktopAPI": true,
      "desktopEnabled": true,
      "usageEnabled": true,
      "autoReload": true,
      "savedState": true,
      "lastDesktop": {
        "kind": "usage",
        "at": 1791043373057,
        "status": "requested"
      },
      "blockedBefore": []
    }
    ```
5. 実際に残量0%を確認してから回復するまで、その使用状況タブを開いておく。実際の回復通知と重複しないことを確認。
   結果: このテストを行うのはユーザーの活動を長時間にわたって停滞させるためユーザーへの負担が大きい。許してほしい。

5は実際の利用枠の状態変化が必要なため、今回の環境では実施していません。回復のために新たな制限を発生させる操作は不要です。
