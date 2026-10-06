#!/bin/sh
# コンテナ化規約5章のテンプレートを、このアプリ（Node）向けに書き換えたもの。
#
# POSIX sh で書くこと（bash 専用の書き方は使わない）。
set -e

# ------------------------------------------------------------
# 1. 自己申告設定（Secrets Manager）を取得して環境変数に入れる
# ------------------------------------------------------------
if [ -n "${PLATFORM_APP_CONFIG_SECRET_ARN:-}" ]; then
    set +e
    app_config_json="$(aws secretsmanager get-secret-value \
        --secret-id "${PLATFORM_APP_CONFIG_SECRET_ARN}" \
        --query SecretString --output text 2>&1)"
    app_config_status=$?
    set -e

    if [ "${app_config_status}" -ne 0 ]; then
        case "${app_config_json}" in
            # まだ誰も値を入れていないだけ。異常ではないので起動を続ける
            *ResourceNotFoundException*) app_config_json="" ;;
            *) echo "ERROR: failed to fetch app-config secret: ${app_config_json}" >&2; exit 1 ;;
        esac
    fi

    if [ -n "${app_config_json}" ]; then
        for config_key in $(echo "${app_config_json}" | jq -r 'keys[]'); do
            case " ${PLATFORM_RESERVED_KEYS:-} " in
                # 基盤が管理しているキー（DB_HOST等）を自己申告設定で上書きさせない
                *" ${config_key} "*)
                    echo "WARN: ignoring platform-reserved key from app-config: ${config_key}" >&2
                    continue
                    ;;
            esac
            config_value=$(echo "${app_config_json}" | jq -r --arg k "${config_key}" '.[$k]')
            export "${config_key}=${config_value}"
        done
    fi
fi

# ------------------------------------------------------------
# 2. マイグレーション
#
# DXはフレームワークを知らずに常に `command: ["migrate"]` で呼べる。
# どのコマンドに読み替えるかはここの責任。
# ------------------------------------------------------------
if [ "$1" = "migrate" ]; then
    exec node packages/server/dist/migrate.js
fi

# ------------------------------------------------------------
# 3. 通常の起動
# ------------------------------------------------------------
exec "$@"
