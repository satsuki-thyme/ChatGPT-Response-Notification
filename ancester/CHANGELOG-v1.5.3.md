# 1.5.3 変更明細

作成日: 2026-10-08 JST。対象: `Dropbox\www\studio\Tampermonkey\ChatGPT-Response-Notification`。

## 利用者への変更

回復とエラーの分離、回復通知のタブ間統合、回復後の余分な停滞通知防止、監視中断の診断、警告後の再開通知修正、待機時間の冒頭明示。追加権限なし。設定・インストール識別子を維持。

## 更新対象

- `MGMT.md`、`README.md`
- `ancester/chatgpt-response-favicon.user.js`、同`.user.txt`
- `ancester/README.md`、`ancester/TESTING.md`、`ancester/package.json`
- `ancester/tests/test-favicon-dom.cjs`、`desktop-tests.cjs`、`warning-tests.cjs`

各元ファイルを同じディレクトリの`<stem>.backup-2026-10-08-NN<extension>`へ改名し、成功を確認してから更新版を同名で作成する。既存連番は上書きしない。実行結果と確定バックアップ名は`REFLECTION-v1.5.3.json`へ記録する。

新規: `PROCESS_CHART.md`、`ancester/DESIGN-v1.5.3.md`、`ancester/1.5.3-report.md`、本書、`ancester/tests/recovery-v1.5.3.cjs`、`ancester/tests/results-v1.5.3.json`、版番号付き配布物。

1.5.2原報告、1.5.3準備レポート、旧配布物・過去結果は保持。GitHubへの書込みなし。

## 検証と未達

構文PASS、113/113模擬検証PASS。Windows実機は未確認。折りたたみ・凍結中の即時通知と通知遅延の解消は未達であり、全要件完了ではない。

配布コードSHA-256: `718960e95c971d623aba5c8b572dce12d70619afa51f27a9431af354d9d3c331`。

## 復旧

更新版を削除せず別の未使用名へ退避し、該当バックアップを元名へ戻す。元名や退避先が存在する場合は上書きせず停止する。Tampermonkeyも1.5.2コードへ戻してページを再読み込みする。
