@echo off
rem ===== BSR日次取得 タスクスケジューラ用 =====
rem
rem タスクスケジューラの「プログラム」にこのファイルのパスを指定するだけで動きます。
rem 引数・開始場所の設定は不要です（このバッチ内で自分の場所に移動します）。
rem
rem 実行ログは logs フォルダの bsr.log に追記されます。
rem 手動で試すときは、このファイルをダブルクリックしてもかまいません。
rem
rem 注意: このファイルは Shift_JIS・改行CRLF で保存してください。
rem       UTF-8 や LF改行で保存し直すと、cmd が読めずエラーになります。

setlocal

rem このバッチが置かれているフォルダ（= packages\bsr）に移動する
cd /d "%~dp0"

if not exist "logs" mkdir "logs"
set LOG=logs\bsr.log

echo.>>"%LOG%"
(echo ===== %DATE% %TIME% start =====)>>"%LOG%"

rem npm.cmd のパスにはスペースが含まれるので、必ず引用符で囲む
call "C:\Program Files\nodejs\npm.cmd" run collect >>"%LOG%" 2>&1
set CODE=%ERRORLEVEL%

rem 数字の直後に >> を書くと cmd がストリーム番号と誤解釈するため、括弧で囲む
(echo ----- finished with exit code %CODE%)>>"%LOG%"

endlocal & exit /b %CODE%
