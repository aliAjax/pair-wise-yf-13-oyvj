// ============================================================
// 舵机试验台账
// 台账数据结构、本地持久化、申请/复核/选模/交接摘要等操作集中维护，
// 判断规则见 rules.ts，页面入口见 SteeringConsole.tsx。
// ============================================================

import {
  evaluateMeasurements,
  modeSelectionBlock,
  type GearId,
  type OperationMode,
  type ReviewMeasurements,
} from "./rules";

/** 值班班次 */
export const SHIFTS = ["00-04班", "04-08班", "08-12班", "12-16班", "16-20班", "20-24班"] as const;

/** 单台舵机的运行状态 */
export interface GearState {
  id: GearId;
  name: string;
  isolated: boolean; // 是否隔离中
  retestDone: boolean; // 复测是否完成
  mode: OperationMode; // 当前操作方式
}

export type ApplicationKind = "isolate" | "restore"; // 隔离申请 / 恢复申请
export type ApplicationStatus = "pending" | "passed" | "failed"; // 待复核 / 已通过 / 不合格

export const APPLICATION_KIND_LABEL: Record<ApplicationKind, string> = {
  isolate: "申请隔离",
  restore: "申请恢复",
};

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending: "待复核",
  passed: "已通过",
  failed: "不合格",
};

/** 一条隔离 / 恢复登记（即一笔记账） */
export interface SteeringApplication extends ReviewMeasurements {
  id: string;
  gearId: GearId;
  kind: ApplicationKind;
  shift: string;
  submittedAt: string; // ISO 时间
  status: ApplicationStatus;
  defects: string[]; // 复核列出的不合格项
  reviewedAt: string | null;
}

export interface LedgerState {
  gears: GearState[];
  applications: SteeringApplication[];
}

const STORAGE_KEY = "hxyfront-62001.steering-ledger.v1";

/** 预置台账：左右两台舵机；右舷舵机检修中，已登记一笔通过的隔离 */
function seedState(): LedgerState {
  return {
    gears: [
      { id: "port", name: "左舷舵机", isolated: false, retestDone: true, mode: "auto" },
      { id: "starboard", name: "右舷舵机", isolated: true, retestDone: false, mode: "emergency" },
    ],
    applications: [
      {
        id: "SG-001",
        gearId: "starboard",
        kind: "isolate",
        shift: "08-12班",
        responsible: "轮机长 王海",
        portFullAngleDeg: 35.2,
        starboardFullAngleDeg: 35.0,
        portArrivalSec: 24.5,
        starboardArrivalSec: 26.8,
        submittedAt: new Date().toISOString(),
        status: "passed",
        defects: [],
        reviewedAt: new Date().toISOString(),
      },
    ],
  };
}

/** 读取台账：本地无记录时写入预置数据；离开页面后记录仍在 */
export function loadLedger(): LedgerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as LedgerState;
    }
  } catch {
    // 本地数据损坏时回退到预置台账
  }
  const seed = seedState();
  saveLedger(seed);
  return seed;
}

export function saveLedger(state: LedgerState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时仅保留内存态
  }
}

export function findGear(state: LedgerState, gearId: GearId): GearState {
  const gear = state.gears.find((g) => g.id === gearId);
  if (!gear) throw new Error(`未知舵机：${gearId}`);
  return gear;
}

/** 同一台舵机是否已有待复核申请 */
export function hasPendingApplication(state: LedgerState, gearId: GearId): boolean {
  return state.applications.some((a) => a.gearId === gearId && a.status === "pending");
}

function nextApplicationId(state: LedgerState): string {
  const maxSeq = state.applications.reduce((max, a) => {
    const seq = Number.parseInt(a.id.replace(/^SG-/, ""), 10);
    return Number.isFinite(seq) ? Math.max(max, seq) : max;
  }, 0);
  return `SG-${String(maxSeq + 1).padStart(3, "0")}`;
}

export interface ApplicationDraft extends ReviewMeasurements {
  gearId: GearId;
  kind: ApplicationKind;
  shift: string;
}

export interface OpResult {
  next: LedgerState;
  error: string | null;
}

/** 提交隔离 / 恢复登记：同一台舵机已有待复核申请时不能重复提交 */
export function submitApplication(state: LedgerState, draft: ApplicationDraft): OpResult {
  if (hasPendingApplication(state, draft.gearId)) {
    return { next: state, error: "该舵机已有待复核申请，不能重复提交" };
  }
  const application: SteeringApplication = {
    ...draft,
    id: nextApplicationId(state),
    submittedAt: new Date().toISOString(),
    status: "pending",
    defects: [],
    reviewedAt: null,
  };
  return {
    next: { ...state, applications: [application, ...state.applications] },
    error: null,
  };
}

/**
 * 复核一笔待复核申请：
 * - 有不合格项 → 记为不合格，设备状态不变（保持隔离），不合格项入账；
 * - 全部合格 → 隔离申请生效为隔离中，恢复申请生效为解除隔离且复测完成。
 */
export function reviewApplication(state: LedgerState, applicationId: string): LedgerState {
  const target = state.applications.find((a) => a.id === applicationId);
  if (!target || target.status !== "pending") return state;

  const defects = evaluateMeasurements(target);
  const reviewed: SteeringApplication = {
    ...target,
    status: defects.length > 0 ? "failed" : "passed",
    defects,
    reviewedAt: new Date().toISOString(),
  };

  const gears = state.gears.map((gear) => {
    if (gear.id !== target.gearId || defects.length > 0) return gear;
    if (target.kind === "isolate") {
      // 隔离生效：自动 / 随动立即不可选，仅应急可接管
      return { ...gear, isolated: true, retestDone: false, mode: "emergency" as OperationMode };
    }
    // 恢复生效：隔离解除且复测完成，自动 / 随动可选回
    return { ...gear, isolated: false, retestDone: true };
  });

  return {
    gears,
    applications: state.applications.map((a) => (a.id === applicationId ? reviewed : a)),
  };
}

/** 选择操作方式：应急可先接管；自动 / 随动须隔离解除并完成复测 */
export function selectMode(state: LedgerState, gearId: GearId, mode: OperationMode): OpResult {
  const gear = findGear(state, gearId);
  const block = modeSelectionBlock(gear, mode);
  if (block) {
    return { next: state, error: `${gear.name}：${block}，不能选择该操作方式` };
  }
  return {
    next: {
      ...state,
      gears: state.gears.map((g) => (g.id === gearId ? { ...g, mode } : g)),
    },
    error: null,
  };
}

export interface StuckRetestItem {
  application: SteeringApplication;
  gearName: string;
  reason: string;
}

export interface HandoverSummary {
  /** 未解除设备：仍处隔离中的舵机 */
  isolatedGears: GearState[];
  /** 卡住的复测项：待复核申请 + 复核不合格未闭环的申请 */
  stuckItems: StuckRetestItem[];
}

/** 交接摘要：列出未解除设备和卡住的复测项 */
export function buildHandoverSummary(state: LedgerState): HandoverSummary {
  const isolatedGears = state.gears.filter((g) => g.isolated);
  const stuckItems = state.applications
    .filter((a) => a.status !== "passed")
    .map((application) => ({
      application,
      gearName: findGear(state, application.gearId).name,
      reason:
        application.status === "pending"
          ? "待复核"
          : `复核不合格：${application.defects.join("；")}`,
    }));
  return { isolatedGears, stuckItems };
}
