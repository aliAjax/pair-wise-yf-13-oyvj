// ============================================================
// 舵机试验判断规则
// 阈值、复核判定、操作方式选择规则集中在本文件维护，
// 台账（ledger.ts）与页面入口（SteeringConsole.tsx）不得各自另写规则。
// ============================================================

/** 满舵实测角度下限（°）：左右满舵均不得低于该值 */
export const REQUIRED_FULL_RUDDER_ANGLE_DEG = 35;

/** 左右满舵到位时间差上限（秒）：超过即判不合格 */
export const MAX_ARRIVAL_TIME_DIFF_SEC = 5;

/** 舵机标识：预置左、右两台舵机 */
export type GearId = "port" | "starboard";

/** 操作方式：自动 / 随动 / 应急 */
export type OperationMode = "auto" | "followUp" | "emergency";

export const OPERATION_MODES: ReadonlyArray<{ id: OperationMode; label: string }> = [
  { id: "auto", label: "自动" },
  { id: "followUp", label: "随动" },
  { id: "emergency", label: "应急" },
];

/** 隔离 / 恢复登记时需要复核的实测数据 */
export interface ReviewMeasurements {
  responsible: string;
  portFullAngleDeg: number | null;
  starboardFullAngleDeg: number | null;
  portArrivalSec: number | null;
  starboardArrivalSec: number | null;
}

function formatAngle(value: number | null): string {
  return value === null ? "未登记" : `${value}°`;
}

/**
 * 复核判定：返回不合格项清单，空数组表示合格。
 * 不合格即保持隔离：实测角度不足、左右到位时间差超过五秒、责任人没写清。
 */
export function evaluateMeasurements(m: ReviewMeasurements): string[] {
  const defects: string[] = [];

  if (!m.responsible.trim()) {
    defects.push("责任人未填写");
  }

  if (m.portFullAngleDeg === null || m.portFullAngleDeg < REQUIRED_FULL_RUDDER_ANGLE_DEG) {
    defects.push(`左满舵实测角度不足${REQUIRED_FULL_RUDDER_ANGLE_DEG}°（实测${formatAngle(m.portFullAngleDeg)}）`);
  }

  if (m.starboardFullAngleDeg === null || m.starboardFullAngleDeg < REQUIRED_FULL_RUDDER_ANGLE_DEG) {
    defects.push(`右满舵实测角度不足${REQUIRED_FULL_RUDDER_ANGLE_DEG}°（实测${formatAngle(m.starboardFullAngleDeg)}）`);
  }

  if (m.portArrivalSec === null || m.starboardArrivalSec === null) {
    defects.push("满舵到位时间未登记完整");
  } else {
    const diff = Math.abs(m.portArrivalSec - m.starboardArrivalSec);
    if (diff > MAX_ARRIVAL_TIME_DIFF_SEC) {
      defects.push(`左右到位时间差${diff.toFixed(1)}秒，超过${MAX_ARRIVAL_TIME_DIFF_SEC}秒`);
    }
  }

  return defects;
}

/**
 * 操作方式选择规则：返回不可选原因，null 表示可选。
 * 应急操舵可先接管（始终可选）；自动、随动须隔离解除且复测完成后才能选回。
 */
export function modeSelectionBlock(
  gear: { isolated: boolean; retestDone: boolean },
  mode: OperationMode,
): string | null {
  if (mode === "emergency") return null;
  if (gear.isolated) return "设备隔离中，待解除";
  if (!gear.retestDone) return "复测未完成";
  return null;
}
