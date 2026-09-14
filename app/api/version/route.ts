import { NextResponse } from "next/server";

/*
 * 部署標記。推上 Zeabur 之後要確認「新版真的上了」，以前只能猜 chunk 檔名有沒有變，
 * 但改的都是伺服器端程式時 chunk 根本不會變，猜不準。這裡回伺服器啟動時間（每次部署都會重啟）
 * 與平台給的 commit（Zeabur 有塞就有），不含任何金鑰或設定值。
 */
const STARTED_AT = new Date().toISOString();
const COMMIT = process.env.ZEABUR_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || process.env.SOURCE_COMMIT || "";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ startedAt: STARTED_AT, commit: COMMIT.slice(0, 12) }, { headers: { "Cache-Control": "no-store" } });
}
