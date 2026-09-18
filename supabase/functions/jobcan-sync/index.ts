// ============================================================
// ジョブカンワークフロー → このアプリ への稟議ステータス取り込み
//
// Supabase Edge Function として動きます。定期実行（既定は15分おき）を想定。
//
// なぜブラウザから直接ジョブカンを叩かないのか:
//   この画面はGitHub Pagesで配信される静的サイトで、JSは誰でも読めます。
//   ジョブカンのAPIトークンを画面に埋めると、社内の稟議を全部読める鍵を公開することになります。
//   そのためトークンはSupabase側（Edge Functionの環境変数）に置き、ここだけが持ちます。
//
// ジョブカンのAPIは参照専用（GETのみ）です。
// このアプリから申請を出すことはできません。申請は従来どおりジョブカンで行います。
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ------------------------------------------------------------
// 設定
// ------------------------------------------------------------

const JOBCAN_API_BASE = 'https://ssl.wf.jobcan.jp/wf_api';

// 必須。ジョブカンの管理画面（会社情報設定 → 共通ID連携・API管理）で発行したトークン。
// ★管理者権限のアカウントで発行すること。発行者の権限が外れるとトークンが無効になります。
const JOBCAN_API_TOKEN = Deno.env.get('JOBCAN_API_TOKEN');

// 任意。粗利稟議のフォームIDをカンマ区切りで指定すると、そのフォームだけを見ます。
// 未設定だと全フォームを取得するため、指定を強く推奨します。
const JOBCAN_FORM_IDS = Deno.env.get('JOBCAN_FORM_IDS');

// 何日前までさかのぼって申請書を見るか。
// ジョブカンのAPIには「更新日で絞る」条件が無いため、
// 申請日でさかのぼって「今の状態」を取り直す方式にしています。
// 稟議が承認されるまでの最長期間より長くしてください。
const LOOKBACK_DAYS = Number(Deno.env.get('JOBCAN_LOOKBACK_DAYS') ?? '90');

// 任意。設定すると、この関数を呼ぶときヘッダ x-sync-secret に同じ値が要るようになります。
const SYNC_SECRET = Deno.env.get('JOBCAN_SYNC_SECRET');

// 取りすぎ防止。1回の実行で読むページ数の上限（1ページ100件）
const MAX_PAGES = 30;

// ------------------------------------------------------------
// ジョブカンのステータス → このアプリのステータス
//
// 差戻し（returned）と取消（canceled_after_completion）はアプリ側の状態に写しません。
// 「下書きに戻す」操作は人の判断が要るのと、勝手に巻き戻ると混乱するためです。
// ジョブカン側の生の状態は jobcanStatus に残るので、画面で理由を説明できます。
// ------------------------------------------------------------

const TARGET_STATUS: Record<string, string | null> = {
  in_progress: 'pending',   // 申請中
  completed: 'approved',    // 承認完了
  rejected: 'rejected',     // 否決
  returned: null,           // 差戻し（アプリ側は動かさない）
  canceled_after_completion: null, // 完了後取消（同上）
};

// 商品ステータスの遷移規則（supabase/01_schema.sql の enforce_status_transition と同じ）。
// 目的地まで1手で行けないときに、途中経路を組み立てるために持っています。
const TRANSITIONS: Record<string, string[]> = {
  draft: ['pending'],
  pending: ['approved', 'rejected'],
  approved: ['selling', 'draft'],
  rejected: ['draft'],
  selling: ['ended'],
  ended: ['selling'],
};

// 販売が始まっている商品は、稟議の状態で巻き戻さない
const FROZEN = new Set(['selling', 'ended']);

// from から to までの経路を返す。辿り着けないときは null。
// 「下書きのまま承認された」ような場合に draft → pending → approved と2段で動かすために使う。
// 遠回り（一度承認してから下書きに戻す等）を避けるため、既定で2手までしか探さない。
function pathTo(from: string, to: string, maxSteps = 2): string[] | null {
  if (from === to) return [];
  const queue: string[][] = [[from]];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (path.length - 1 >= maxSteps) continue;
    const last = path[path.length - 1];
    for (const next of TRANSITIONS[last] ?? []) {
      if (next === to) return [...path.slice(1), next];
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}

// ------------------------------------------------------------
// 日付
// ------------------------------------------------------------

// ジョブカンは日本時間で動いているので、日本時間の文字列を作る。
// toISOString() はUTCに変換してしまうので使わない（1日ずれる）。
function jstDateTime(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${jst.getUTCFullYear()}/${p(jst.getUTCMonth() + 1)}/${p(jst.getUTCDate())} ` +
    `${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())}:${p(jst.getUTCSeconds())}`
  );
}

// ------------------------------------------------------------
// タイトルから商品IDを読み取る
//
// 運用の約束: 稟議のタイトルに商品ID（A0001）を含める。
// 「【粗利稟議】A0123 熊本県産あさり 500g」のような書き方を想定しています。
// ------------------------------------------------------------

const PRODUCT_ID_RE = /\bA\d{4,}\b/gi;

function productIdsIn(title: string): string[] {
  const found = title.toUpperCase().match(PRODUCT_ID_RE);
  return found ? [...new Set(found)] : [];
}

// ------------------------------------------------------------
// ジョブカンから申請書を取得する
// ------------------------------------------------------------

type JobcanRequest = {
  id: number;
  title: string;
  status: string;
  form_id?: number;
  form_name?: string;
  applied_date?: string;
  final_approved_date?: string | null;
};

async function fetchRequests(appliedAfter: string): Promise<JobcanRequest[]> {
  const all: JobcanRequest[] = [];
  const formIds = (JOBCAN_FORM_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // フォームを指定しない場合は1回だけ回す
  const targets = formIds.length > 0 ? formIds : [null];

  for (const formId of targets) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = new URL(`${JOBCAN_API_BASE}/v2/requests/`);
      url.searchParams.set('applied_after', appliedAfter);
      url.searchParams.set('page', String(page));
      if (formId) url.searchParams.set('form_id', formId);

      const res = await fetch(url, {
        headers: {
          // 「Token」は置き換える文字列ではなく、そのまま書く
          Authorization: `Token ${JOBCAN_API_TOKEN}`,
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `ジョブカンAPIがエラーを返しました (HTTP ${res.status}): ${body.slice(0, 300)}`
        );
      }

      const json = await res.json();
      const rows: JobcanRequest[] = json.results ?? json.data ?? [];
      all.push(...rows);

      // next が無ければ最終ページ
      if (!json.next || rows.length === 0) break;
    }
  }

  return all;
}

// ------------------------------------------------------------
// 本体
// ------------------------------------------------------------

Deno.serve(async (req) => {
  if (SYNC_SECRET && req.headers.get('x-sync-secret') !== SYNC_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  // service_role で動かします。RLSを通らずに商品のステータスを更新するためです。
  // このキーはSupabaseがEdge Functionに自動で渡すもので、
  // リポジトリにも画面のコードにも入っていません（CLAUDE.md「絶対に守ること」3）。
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );

  const { data: run } = await supabase
    .from('jobcan_sync_runs')
    .insert({ startedAt: new Date().toISOString() })
    .select('id')
    .single();

  const runId = run?.id;
  const finish = async (fields: Record<string, unknown>) => {
    if (runId) {
      await supabase
        .from('jobcan_sync_runs')
        .update({ finishedAt: new Date().toISOString(), ...fields })
        .eq('id', runId);
    }
  };

  try {
    if (!JOBCAN_API_TOKEN) {
      throw new Error(
        'JOBCAN_API_TOKEN が設定されていません。Supabaseのシークレットに登録してください。'
      );
    }

    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const requests = await fetchRequests(jstDateTime(since));

    // 同じ商品IDに複数の稟議がぶら下がる場合は、新しい申請を優先する
    const byProductId = new Map<string, JobcanRequest>();
    let unmatched = 0;

    for (const r of requests) {
      const ids = productIdsIn(r.title ?? '');
      if (ids.length === 0) {
        unmatched++;
        continue;
      }
      for (const pid of ids) {
        const prev = byProductId.get(pid);
        if (!prev || (r.id ?? 0) > (prev.id ?? 0)) byProductId.set(pid, r);
      }
    }

    let updated = 0;
    const problems: string[] = [];

    for (const [productId, r] of byProductId) {
      const { data: product } = await supabase
        .from('products')
        .select('id, status')
        .eq('productId', productId)
        .maybeSingle();

      if (!product) {
        // タイトルに商品IDらしき文字列はあったが、該当する商品が無い
        unmatched++;
        continue;
      }

      // ジョブカン側の情報はステータスを動かせなくても必ず記録する。
      // 「差戻しになっている」ことが画面で分かるようにするため。
      const meta = {
        jobcanRequestId: r.id,
        jobcanStatus: r.status,
        jobcanTitle: r.title,
        jobcanAppliedAt: r.applied_date ?? null,
        jobcanApprovedAt: r.final_approved_date ?? null,
        jobcanSyncedAt: new Date().toISOString(),
      };
      await supabase.from('products').update(meta).eq('id', product.id);

      const target = TARGET_STATUS[r.status] ?? null;
      if (!target || target === product.status) continue;
      if (FROZEN.has(product.status)) continue;

      const steps = pathTo(product.status, target);
      if (!steps) {
        problems.push(`${productId}: 「${product.status}」から「${target}」には変更できません`);
        continue;
      }

      // 遷移制限のトリガーに合わせて1段ずつ動かす
      let ok = true;
      for (const step of steps) {
        const { error } = await supabase
          .from('products')
          .update({ status: step })
          .eq('id', product.id);
        if (error) {
          problems.push(`${productId}: ${error.message}`);
          ok = false;
          break;
        }
      }
      if (ok) updated++;
    }

    await finish({
      fetched: requests.length,
      updated,
      unmatched,
      error: problems.length > 0 ? problems.join('\n') : null,
    });

    return Response.json({
      ok: true,
      fetched: requests.length,
      matched: byProductId.size,
      updated,
      unmatched,
      problems,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finish({ error: message });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
