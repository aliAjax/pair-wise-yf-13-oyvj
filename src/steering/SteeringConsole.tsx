// 舵机试验与隔离台（页面入口，单独维护）
import { useEffect, useState } from "react";
import {
  ACTION_LABELS,
  GEARS,
  SHIFTS,
  STATUS_LABELS,
  createEntry,
  formatTime,
  hasPendingEntry,
  loadGears,
  loadLedger,
  saveGears,
  saveLedger,
  type GearId,
  type GearMap,
  type GearRuntime,
  type LedgerAction,
  type LedgerEntry,
} from "./ledger";
import {
  MAX_ARRIVAL_TIME_DIFF,
  MIN_FULL_RUDDER_ANGLE,
  MODES,
  MODE_LABELS,
  evaluateMeasurements,
  modeSelectionBlock,
  type OperationMode,
} from "./rules";

interface FormState {
  gearId: GearId;
  action: LedgerAction;
  shift: string;
  responsible: string;
  portAngle: string;
  starboardAngle: string;
  portTime: string;
  starboardTime: string;
  note: string;
}

function toNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function gearStatus(gear: GearRuntime): { text: string; className: string } {
  if (gear.isolated) return { text: "隔离中", className: "isolated" };
  if (!gear.retestDone) return { text: "待复测", className: "retest" };
  return { text: "在役", className: "in-service" };
}

function fmtValue(value: number | null, unit: string): string {
  return value === null ? "未登记" : `${value}${unit}`;
}

export default function SteeringConsole() {
  const [gears, setGears] = useState<GearMap>(loadGears);
  const [ledger, setLedger] = useState<LedgerEntry[]>(loadLedger);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState("");

  // 记录离开页面后仍在：任何变化都写回浏览器本地存储
  useEffect(() => saveGears(gears), [gears]);
  useEffect(() => saveLedger(ledger), [ledger]);

  const pendingCount = ledger.filter((entry) => entry.status === "pending").length;
  const emergencyCount = GEARS.filter((info) => gears[info.id].mode === "emergency").length;
  const unreleased = GEARS.filter((info) => gears[info.id].isolated);
  const stuckRetest = GEARS.filter((info) => !gears[info.id].isolated && !gears[info.id].retestDone);

  function openForm(gearId: GearId, action: LedgerAction) {
    setFormError("");
    setForm({
      gearId,
      action,
      shift: SHIFTS[0],
      responsible: "",
      portAngle: "",
      starboardAngle: "",
      portTime: "",
      starboardTime: "",
      note: "",
    });
  }

  function submitForm() {
    if (!form) return;
    if (hasPendingEntry(ledger, form.gearId)) {
      setFormError("该舵机已有待复核申请，复核完成前不能重复提交。");
      return;
    }
    const entry = createEntry({
      gearId: form.gearId,
      action: form.action,
      shift: form.shift,
      responsible: form.responsible.trim(),
      portAngle: toNumber(form.portAngle),
      starboardAngle: toNumber(form.starboardAngle),
      portTime: toNumber(form.portTime),
      starboardTime: toNumber(form.starboardTime),
      note: form.note.trim(),
    });
    setLedger((prev) => [entry, ...prev]);
    // 安全优先：隔离申请一经登记立即生效，自动/随动马上退出
    if (form.action === "isolate") {
      setGears((prev) => {
        const gear = { ...prev[form.gearId] };
        gear.isolated = true;
        gear.retestDone = false;
        if (gear.mode !== "emergency") gear.mode = null;
        return { ...prev, [form.gearId]: gear };
      });
    }
    setForm(null);
  }

  function reviewEntry(id: string) {
    const target = ledger.find((entry) => entry.id === id);
    if (!target || target.status !== "pending") return;
    const failures = evaluateMeasurements(target);
    const approved = failures.length === 0;
    setLedger((prev) =>
      prev.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status: approved ? "approved" : "rejected",
              failures,
              reviewedAt: new Date().toISOString(),
            }
          : entry
      )
    );
    setGears((prev) => {
      const gear = { ...prev[target.gearId] };
      if (target.action === "restore" && approved) {
        // 解除隔离后必须完成复测，自动/随动才能选回
        gear.isolated = false;
        gear.retestDone = false;
      }
      if (target.action === "retest" && approved) {
        gear.retestDone = true;
      }
      // 复核不通过：保持隔离，设备状态不变，不合格项已写入台账
      return { ...prev, [target.gearId]: gear };
    });
  }

  function selectMode(gearId: GearId, mode: OperationMode) {
    if (modeSelectionBlock(gears[gearId], mode) !== null) return;
    setGears((prev) => ({ ...prev, [gearId]: { ...prev[gearId], mode } }));
  }

  return (
    <>
      <section className="metrics">
        <article>
          <small>隔离中设备</small>
          <strong>{unreleased.length}</strong>
        </article>
        <article>
          <small>待复核申请</small>
          <strong>{pendingCount}</strong>
        </article>
        <article>
          <small>卡住的复测项</small>
          <strong>{stuckRetest.length}</strong>
        </article>
        <article>
          <small>应急接管中</small>
          <strong>{emergencyCount}</strong>
        </article>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>舵机试验与隔离台</p>
            <h2>靠港试舵 · 隔离与恢复</h2>
          </div>
        </div>
        <p className="hint">
          判断规则：左右满舵实测角度 ≥ {MIN_FULL_RUDDER_ANGLE}°；左右到位时间差 ≤ {MAX_ARRIVAL_TIME_DIFF}
          秒；责任人必须写清。应急操舵可随时先接管；自动、随动须隔离解除并完成复测后才能选回。
        </p>
      </section>

      <div className="gear-grid">
        {GEARS.map((info) => {
          const gear = gears[info.id];
          const status = gearStatus(gear);
          const pending = hasPendingEntry(ledger, info.id);
          const blockReason = modeSelectionBlock(gear, "auto");
          return (
            <article key={info.id} className="panel gear-card">
              <header>
                <h3>{info.name}</h3>
                <span className={`badge ${status.className}`}>{status.text}</span>
              </header>
              <p className="hint">当前操作方式：{gear.mode ? MODE_LABELS[gear.mode] : "未投入"}</p>
              <div className="mode-row">
                {MODES.map((mode) => (
                  <button
                    key={mode}
                    className={gear.mode === mode ? "mode-active" : ""}
                    disabled={modeSelectionBlock(gear, mode) !== null}
                    onClick={() => selectMode(info.id, mode)}
                  >
                    {MODE_LABELS[mode]}
                  </button>
                ))}
              </div>
              <p className={`hint${blockReason ? " warn" : ""}`}>
                {blockReason ? `${blockReason}；应急可随时先接管。` : "自动/随动可选回，应急可随时接管。"}
              </p>
              <div className="actions">
                {!gear.isolated && (
                  <button className="primary" disabled={pending} onClick={() => openForm(info.id, "isolate")}>
                    申请隔离
                  </button>
                )}
                {gear.isolated && (
                  <button className="primary" disabled={pending} onClick={() => openForm(info.id, "restore")}>
                    申请恢复
                  </button>
                )}
                {!gear.isolated && !gear.retestDone && (
                  <button disabled={pending} onClick={() => openForm(info.id, "retest")}>
                    提交复测
                  </button>
                )}
              </div>
              {pending && <p className="hint warn">已有待复核申请，复核完成前不能重复提交。</p>}
            </article>
          );
        })}
      </div>

      {form && (
        <section className="panel">
          <div className="heading">
            <div>
              <p>{gears[form.gearId].name}</p>
              <h2>{ACTION_LABELS[form.action]}登记</h2>
            </div>
            <button onClick={() => setForm(null)}>取消</button>
          </div>
          <div className="field-grid">
            <label>
              <span>值班班次</span>
              <select value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })}>
                {SHIFTS.map((shift) => (
                  <option key={shift} value={shift}>
                    {shift}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>责任人</span>
              <input
                value={form.responsible}
                placeholder="填写责任人姓名"
                onChange={(e) => setForm({ ...form, responsible: e.target.value })}
              />
            </label>
            <label>
              <span>左满舵实测角度（°）</span>
              <input
                type="number"
                step="0.1"
                value={form.portAngle}
                placeholder={`≥ ${MIN_FULL_RUDDER_ANGLE}`}
                onChange={(e) => setForm({ ...form, portAngle: e.target.value })}
              />
            </label>
            <label>
              <span>右满舵实测角度（°）</span>
              <input
                type="number"
                step="0.1"
                value={form.starboardAngle}
                placeholder={`≥ ${MIN_FULL_RUDDER_ANGLE}`}
                onChange={(e) => setForm({ ...form, starboardAngle: e.target.value })}
              />
            </label>
            <label>
              <span>左满舵到位时间（秒）</span>
              <input
                type="number"
                step="0.1"
                value={form.portTime}
                placeholder="实测秒数"
                onChange={(e) => setForm({ ...form, portTime: e.target.value })}
              />
            </label>
            <label>
              <span>右满舵到位时间（秒）</span>
              <input
                type="number"
                step="0.1"
                value={form.starboardTime}
                placeholder="实测秒数"
                onChange={(e) => setForm({ ...form, starboardTime: e.target.value })}
              />
            </label>
            <label>
              <span>备注</span>
              <input
                value={form.note}
                placeholder="检修项目、试舵情况等"
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </label>
          </div>
          {formError && <p className="hint warn">{formError}</p>}
          <div className="actions">
            <button className="primary" onClick={submitForm}>
              提交{ACTION_LABELS[form.action]}
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="heading">
          <div>
            <p>交接摘要</p>
            <h2>未解除设备与卡住的复测项</h2>
          </div>
        </div>
        <div className="summary-grid">
          <div>
            <h3>未解除设备（{unreleased.length}）</h3>
            {unreleased.length === 0 ? (
              <p className="hint">无，全部舵机均已解除隔离。</p>
            ) : (
              <ul className="summary-list">
                {unreleased.map((info) => (
                  <li key={info.id}>
                    {info.name}：隔离中，
                    {hasPendingEntry(ledger, info.id) ? "恢复申请待复核" : "尚未提交恢复申请"}，自动/随动不可选回
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3>卡住的复测项（{stuckRetest.length}）</h3>
            {stuckRetest.length === 0 ? (
              <p className="hint">无，解除隔离的设备均已完成复测。</p>
            ) : (
              <ul className="summary-list">
                {stuckRetest.map((info) => (
                  <li key={info.id}>
                    {info.name}：隔离已解除，复测
                    {hasPendingEntry(ledger, info.id) ? "申请待复核" : "未完成"}，自动/随动暂不能选回
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {pendingCount > 0 && <p className="hint">另有 {pendingCount} 项申请待轮机长复核，详见试验台账。</p>}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>试验台账</p>
            <h2>隔离 / 恢复 / 复测记录</h2>
          </div>
        </div>
        <div className="ledger">
          {ledger.map((entry) => {
            const diff =
              entry.portTime !== null && entry.starboardTime !== null
                ? Math.abs(entry.portTime - entry.starboardTime).toFixed(1)
                : null;
            return (
              <article key={entry.id} className="ledger-item">
                <header>
                  <strong>
                    {gears[entry.gearId].name} · {ACTION_LABELS[entry.action]}
                  </strong>
                  <span className={`badge ${entry.status}`}>{STATUS_LABELS[entry.status]}</span>
                </header>
                <p>
                  {entry.shift} · 责任人：{entry.responsible || "未填写"} · 登记于 {formatTime(entry.submittedAt)}
                </p>
                <p>
                  左满舵 {fmtValue(entry.portAngle, "°")} / 右满舵 {fmtValue(entry.starboardAngle, "°")} · 左到位{" "}
                  {fmtValue(entry.portTime, "秒")} / 右到位 {fmtValue(entry.starboardTime, "秒")}
                  {diff !== null && `（时间差 ${diff} 秒）`}
                </p>
                {entry.note && <p>备注：{entry.note}</p>}
                {entry.failures.length > 0 && (
                  <ul className="failures">
                    {entry.failures.map((failure) => (
                      <li key={failure}>{failure}</li>
                    ))}
                  </ul>
                )}
                {entry.status === "pending" ? (
                  <div className="actions">
                    <button className="primary" onClick={() => reviewEntry(entry.id)}>
                      轮机长复核
                    </button>
                  </div>
                ) : (
                  entry.reviewedAt && <p className="hint">复核于 {formatTime(entry.reviewedAt)}</p>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
