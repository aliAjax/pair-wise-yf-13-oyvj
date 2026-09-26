// 舵机试验判断规则（单独维护）：阈值调整只改本文件

export const MIN_FULL_RUDDER_ANGLE = 35; // 满舵实测角度下限（°）
export const MAX_ARRIVAL_TIME_DIFF = 5; // 左右到位时间差上限（秒）

export type OperationMode = "auto" | "followUp" | "emergency";

export const MODES: OperationMode[] = ["auto", "followUp", "emergency"];

export const MODE_LABELS: Record<OperationMode, string> = {
  auto: "自动",
  followUp: "随动",
  emergency: "应急",
};

export interface MeasurementInput {
  responsible: string;
  portAngle: number | null; // 左满舵实测角度（°）
  starboardAngle: number | null; // 右满舵实测角度（°）
  portTime: number | null; // 左满舵到位时间（秒）
  starboardTime: number | null; // 右满舵到位时间（秒）
}

// 复核规则：实测角度不足 / 到位时间差超 5 秒 / 责任人没写清 → 不合格，保持隔离
export function evaluateMeasurements(input: MeasurementInput): string[] {
  const failures: string[] = [];

  if (!input.responsible.trim()) {
    failures.push("责任人未写清");
  }
  if (input.portAngle === null || input.portAngle < MIN_FULL_RUDDER_ANGLE) {
    failures.push(`左满舵实测角度不足${MIN_FULL_RUDDER_ANGLE}°`);
  }
  if (input.starboardAngle === null || input.starboardAngle < MIN_FULL_RUDDER_ANGLE) {
    failures.push(`右满舵实测角度不足${MIN_FULL_RUDDER_ANGLE}°`);
  }
  if (input.portTime === null || input.starboardTime === null) {
    failures.push("到位时间未登记完整");
  } else {
    const diff = Math.abs(input.portTime - input.starboardTime);
    if (diff > MAX_ARRIVAL_TIME_DIFF) {
      failures.push(`左右到位时间差${diff.toFixed(1)}秒，超过${MAX_ARRIVAL_TIME_DIFF}秒`);
    }
  }

  return failures;
}

export interface GearState {
  isolated: boolean; // 是否隔离中
  retestDone: boolean; // 解除隔离后复测是否已通过
  mode: OperationMode | null; // 当前操作方式
}

// 选回规则：应急可随时先接管；自动/随动须隔离解除且复测完成后才能选回
export function modeSelectionBlock(gear: GearState, mode: OperationMode): string | null {
  if (mode === "emergency") return null;
  if (gear.isolated) return "设备隔离中，须解除隔离并完成复测后才能选回";
  if (!gear.retestDone) return "复测未完成，自动/随动暂不能选回";
  return null;
}
