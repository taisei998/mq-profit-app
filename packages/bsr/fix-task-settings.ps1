# ===== タスクスケジューラの設定を直すスクリプト（管理者として実行）=====
#
# 何をするか:
#   毎朝のBSR取得・検索順位取得タスクを「ユーザーがログオンしているかどうかに
#   かかわらず実行する」に変更します。これで9時に黒いコンソール画面が出なくなり、
#   ウィンドウを閉じてしまって処理が止まる事故（終了コード 0xC000013A）を防げます。
#   ログオフ中やロック中でも動くようになります。
#
# 使い方:
#   1. スタートボタンを右クリック →「ターミナル(管理者)」または「PowerShell(管理者)」
#   2. 次の1行を貼り付けて Enter
#        & "C:\Users\pc424\Documents\apps\ec-ai\packages\bsr\fix-task-settings.ps1"
#
# 元に戻したいとき:
#   タスクのプロパティ →「全般」タブ →「ユーザーがログオンしているときのみ実行する」
#   に戻すだけです。このスクリプトは実行前にバックアップも取ります。

$ErrorActionPreference = 'Stop'
$taskNames = @('AmazonBSR取得(毎朝9時)', 'Amazon検索順位(毎朝9時)')

# --- 管理者かどうか確認 ---
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).
  IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host '管理者として実行してください。' -ForegroundColor Red
  Write-Host 'スタートボタンを右クリック →「ターミナル(管理者)」から、もう一度この行を実行してください:'
  Write-Host "  & `"$PSCommandPath`""
  exit 1
}

# --- 変更前のバックアップ ---
$backupDir = Join-Path $PSScriptRoot 'task-backup'
New-Item -ItemType Directory -Force $backupDir | Out-Null
foreach ($name in $taskNames) {
  $safe = $name -replace '[\\/:*?"<>|()]', '_'
  $path = Join-Path $backupDir "$safe.xml"
  [System.IO.File]::WriteAllText($path, (Export-ScheduledTask -TaskName $name), [System.Text.Encoding]::Unicode)
  Write-Host "バックアップ: $path"
}

# --- 適用 ---
# S4U は「パスワードを保存せずに、ログオンしていなくても実行する」方式。
# 画面に何も表示されなくなるのが目的なので、実行レベル(RunLevel)は今のまま変えない。
foreach ($name in $taskNames) {
  $task = Get-ScheduledTask -TaskName $name
  $principal = New-ScheduledTaskPrincipal -UserId $task.Principal.UserId -LogonType S4U -RunLevel $task.Principal.RunLevel
  Set-ScheduledTask -TaskName $name -Principal $principal | Out-Null
  Write-Host "変更しました: $name" -ForegroundColor Green
}

# --- 確認 ---
Write-Host "`n--- 変更後の設定 ---"
foreach ($name in $taskNames) {
  $t = Get-ScheduledTask -TaskName $name
  $mode = if ($t.Principal.LogonType -eq 'S4U' -or $t.Principal.LogonType -eq 'Password') {
    'ログオン状態にかかわらず実行（画面に出ない）'
  } else {
    'ログオン時のみ実行（画面に出る）'
  }
  Write-Host ("  {0}`n    実行ユーザー: {1} / {2}" -f $t.TaskName, $t.Principal.UserId, $mode)
}

Write-Host "`n動作確認として、BSR取得タスクを1回実行します（今日のぶんは取得済みなのでスキップされるはずです）..."
Start-ScheduledTask -TaskName 'AmazonBSR取得(毎朝9時)'
Start-Sleep -Seconds 25
$info = Get-ScheduledTaskInfo -TaskName 'AmazonBSR取得(毎朝9時)'
Write-Host ("  実行結果: 0x{0:X}  {1}" -f $info.LastTaskResult, $(if ($info.LastTaskResult -eq 0) { '← 正常' } else { '← ログを確認してください' }))
Write-Host "  ログ: $(Join-Path $PSScriptRoot 'logs\bsr.log') の末尾を見てください。"
