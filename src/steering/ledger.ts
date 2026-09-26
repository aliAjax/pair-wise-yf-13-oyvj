// 舵机试验台账（单独维护）：数据模型、本地持久化与台账操作
import type { GearState } from "./rules";

export type GearId = "port" | "starboard";

export interface GearInfo {
  id: GearId;
  name: string;
}

export const GEARS: GearInfo[] = [
  { id: "port", name: "左舵机" },
  { id: "starboard", name: "右舵机" },
];

export const SHIFTS = ["00-04班", "04-08班", "08-12班", "12-16班", "16-20班", "20-24班"];

export type LedgerAction = "isolate" | "restore" | "retest";

export const ACTION_LABELS: Record<LedgerAction, string> = {
  isolate: "隔离申请",
  restore: "恢复申请",
  retest: "复测申请",
};

export type LedgerStatus = "pending" | "approved" | "rejected";

export const STATUS_LABELS: Record<LedgerStatus, string> = {
  pending: "待复核",
  approved: "复核通过",
  rejected: "复核不通过",
};

export interface LedgerEntry {
  id: string;
  gearId: GearId;
  action: LedgerAction;
  shift: string;
  responsible: string;
  portAngle: number | null;
  starboardAngle: number | null;
  portTime: number | null;
  starboardTime: number | null;
  note: string;
  submittedAt: string; // ISO 时间
  status: LedgerStatus;
  failures: string[]; // 复核列出的不合格项
  reviewedAt: string | null;
}

export interface GearRuntime extends GearState {
  id: GearId;
  name: string;
}

export type GearMap = Record<GearId, GearRuntime>;

const LEDGER_KEY = "hxyfront-62001:steering-ledger";
const GEARS_KEY = "hxyfront-62001:steering-gears";

export function initialGears(): GearMap {
  return {
    port: { id: "port", name: "左舵机", isolated: false, retestDone: true, mode: "auto" },
    starboard: { id: "starboard", name: "右舵机", isolated: false, retestDone: true, mode: null },
  };
}

// 首次打开时的历史台账，演示隔离→恢复→复测及不合格退回的完整链路
export function seedLedger(): LedgerEntry[] {
  return [
    {
      id: "SG-seed-07",
      gearId: "starboard",
      action: "retest",
      shift: "00-04班",
      responsible: "李工",
      portAngle: 35.2,
      starboardAngle: 35.0,
      portTime: 26.8,
      starboardTime: 27.5,
      note: "复测合格，右舵机恢复自动/随动可选",
      submittedAt: "2026-09-26T01:40:00+08:00",
      status: "approved",
      failures: [],
      reviewedAt: "2026-09-26T01:55:00+08:00",
    },
    {
      id: "SG-seed-06",
      gearId: "starboard",
      action: "restore",
      shift: "00-04班",
      responsible: "李工",
      portAngle: 35.4,
      starboardAngle: 35.1,
      portTime: 27.0,
      starboardTime: 27.2,
      note: "重新登记，数据复核合格",
      submittedAt: "2026-09-26T00:50:00+08:00",
      status: "approved",
      failures: [],
      reviewedAt: "2026-09-26T01:05:00+08:00",
    },
    {
      id: "SG-seed-05",
      gearId: "starboard",
      action: "restore",
      shift: "20-24班",
      responsible: "",
      portAngle: 35.4,
      starboardAngle: 33.8,
      portTime: 26.4,
      starboardTime: 32.6,
      note: "检修后首次恢复试验",
      submittedAt: "2026-09-25T22:10:00+08:00",
      status: "rejected",
      failures: ["责任人未写清", "右满舵实测角度不足35°", "左右到位时间差6.2秒，超过5秒"],
      reviewedAt: "2026-09-25T22:20:00+08:00",
    },
    {
      id: "SG-seed-04",
      gearId: "starboard",
      action: "isolate",
      shift: "16-20班",
      responsible: "王机匠",
      portAngle: 35.1,
      starboardAngle: 35.3,
      portTime: 27.1,
      starboardTime: 26.6,
      note: "右舵机液压泵检修，申请隔离",
      submittedAt: "2026-09-25T17:30:00+08:00",
      status: "approved",
      failures: [],
      reviewedAt: "2026-09-25T17:45:00+08:00",
    },
    {
      id: "SG-seed-03",
      gearId: "port",
      action: "retest",
      shift: "12-16班",
      responsible: "赵轮机员",
      portAngle: 35.0,
      starboardAngle: 35.2,
      portTime: 27.4,
      starboardTime: 27.0,
      note: "",
      submittedAt: "2026-09-25T14:20:00+08:00",
      status: "approved",
      failures: [],
      reviewedAt: "2026-09-25T14:35:00+08:00",
    },
    {
      id: "SG-seed-02",
      gearId: "port",
      action: "restore",
      shift: "12-16班",
      responsible: "赵轮机员",
      portAngle: 35.3,
      starboardAngle: 35.0,
      portTime: 26.9,
      starboardTime: 27.3,
      note: "",
      submittedAt: "2026-09-25T13:10:00+08:00",
      status: "approved",
      failures: [],
      reviewedAt: "2026-09-25T13:25:00+08:00",
    },
    {
      id: "SG-seed-01",
      gearId: "port",
      action: "isolate",
      shift: "08-12班",
      responsible: "赵轮机员",
      portAngle: 35.2,
      starboardAngle: 35.1,
      portTime: 27.2,
      starboardTime: 26.8,
      note: "靠港前例行试舵后隔离检查",
      submittedAt: "2026-09-25T09:40:00+08:00",
      status: "approved",
      failures: [],
      reviewedAt: "2026-09-25T09:55:00+08:00",
    },
  ];
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 本地存储不可用时静默降级，页面内状态仍有效
  }
}

export function loadLedger(): LedgerEntry[] {
  return readJson<LedgerEntry[]>(LEDGER_KEY) ?? seedLedger();
}

export function loadGears(): GearMap {
  return readJson<GearMap>(GEARS_KEY) ?? initialGears();
}

export function saveLedger(entries: LedgerEntry[]): void {
  writeJson(LEDGER_KEY, entries);
}

export function saveGears(gears: GearMap): void {
  writeJson(GEARS_KEY, gears);
}

// 同一台舵机已有待复核申请时，不允许重复提交
export function hasPendingEntry(entries: LedgerEntry[], gearId: GearId): boolean {
  return entries.some((entry) => entry.gearId === gearId && entry.status === "pending");
}

export interface NewEntryInput {
  gearId: GearId;
  action: LedgerAction;
  shift: string;
  responsible: string;
  portAngle: number | null;
  starboardAngle: number | null;
  portTime: number | null;
  starboardTime: number | null;
  note: string;
}

export function createEntry(input: NewEntryInput): LedgerEntry {
  return {
    ...input,
    id: `SG-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    submittedAt: new Date().toISOString(),
    status: "pending",
    failures: [],
    reviewedAt: null,
  };
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
