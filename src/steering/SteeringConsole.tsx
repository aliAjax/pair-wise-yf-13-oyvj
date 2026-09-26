// ============================================================
// 舵机试验与隔离台 · 页面入口
// 仅负责渲染与交互；判断规则见 rules.ts，台账与持久化见 ledger.ts。
// ============================================================

import { useEffect, useState } from "react";
import {
  MAX_ARRIVAL_TIME_DIFF_SEC,
  OPERATION_MODES,
  REQUIRED_FULL_RUDDER_ANGLE_DEG,
  modeSelectionBlock,
  type GearId,
  type OperationMode,
} from "./rules";
import {
  APPLICATION_KIND_LABEL,
  APPLICATION_STATUS_LABEL,
  SHIFTS,
  buildHandoverSummary,
  hasPendingApplication,
  loadLedger,
  reviewApplication,
  saveLedger,
  selectMode,
  submitApplication,
  type ApplicationKind,
  type LedgerState,
} from "./ledger";

interface FormState {
  gearId: GearId;
  kind: ApplicationKind;
  shift: string;
  responsible: string;
  portFullAngleDeg: string;
  starboardFullAngleDeg: string;
  portArrivalSec: string;
  starboardArrivalSec: string;
}

const INITIAL_FORM: FormState = {
  gearId: "port",
  kind: "isolate",
  shift: SHIFTS[2],
  responsible: "",
  portFullAngleDeg: "",
  starboardFullAngleDeg: "",
  portArrivalSec: "",
  starboardArrivalSec: "",
};

function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("zh-CN", { hour12: false });
}

const MODE_LABEL: Record<OperationMode, string> = { auto: "自动", followUp: "随动", emergency: "应急" };

export default function SteeringConsole() {
  const [ledger, setLedger] = useState<LedgerState>(loadLedger);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  // 台账变更即写入本地，离开页面后记录仍在
  useEffect(() => {
    saveLedger(ledger);
  }, [ledger]);

  const summary = buildHandoverSummary(ledger);
  const pendingList = ledger.applications.filter((a) => a.status === "pending");
  const selectedGearPending = hasPendingApplication(ledger, form.gearId);

  const updateForm = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSubmit = () => {
    const result = submitApplication(ledger, {
      gearId: form.gearId,
      kind: form.kind,
      shift: form.shift,
      responsible: form.responsible,
      portFullAngleDeg: parseNumber(form.portFullAngleDeg),
      starboardFullAngleDeg: parseNumber(form.starboardFullAngleDeg),
      portArrivalSec: parseNumber(form.portArrivalSec),
      starboardArrivalSec: parseNumber(form.starboardArrivalSec),
    });
    if (result.error) {
      setNotice({ kind: "error", text: result.error });
      return;
    }
    setLedger(result.next);
    setForm((prev) => ({
      ...prev,
      responsible: "",
      portFullAngleDeg: "",
      starboardFullAngleDeg: "",
      portArrivalSec: "",
      starboardArrivalSec: "",
    }));
    setNotice({ kind: "ok", text: "登记已提交，等待复核" });
  };

  const handleReview = (applicationId: string) => {
    setLedger((prev) => reviewApplication(prev, applicationId));
    setNotice(null);
  };

  const handleSelectMode = (gearId: GearId, mode: OperationMode) => {
    const result = selectMode(ledger, gearId, mode);
    if (result.error) {
      setNotice({ kind: "error", text: result.error });
      return;
    }
    setLedger(result.next);
    setNotice(null);
  };

  return (
    <section className="steering">
      <div className="heading">
        <div>
          <p>靠港试舵 · 防误选</p>
          <h2>舵机试验与隔离台</h2>
        </div>
        <span className="rule-hint">
          判定规则：左右满舵 ≥ {REQUIRED_FULL_RUDDER_ANGLE_DEG}°，到位时间差 ≤ {MAX_ARRIVAL_TIME_DIFF_SEC}
          秒，责任人必填；应急可先接管，自动 / 随动须解除隔离并完成复测
        </span>
      </div>

      {notice && (
        <div className={`banner ${notice.kind}`} role="status">
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)}>
            知道了
          </button>
        </div>
      )}

      {/* 舵机状态与操作方式 */}
      <div className="gear-grid">
        {ledger.gears.map((gear) => {
          const pending = hasPendingApplication(ledger, gear.id);
          return (
            <article key={gear.id} className={`gear-card ${gear.isolated ? "isolated" : ""}`}>
              <div className="gear-head">
                <h3>{gear.name}</h3>
                <div className="badges">
                  <span className={`badge ${gear.isolated ? "danger" : "ok"}`}>
                    {gear.isolated ? "隔离中" : "在役"}
                  </span>
                  <span className={`badge ${gear.retestDone ? "ok" : "warn"}`}>
                    {gear.retestDone ? "复测完成" : "待复测"}
                  </span>
                  {pending && <span className="badge warn">有待复核申请</span>}
                </div>
              </div>
              <p className="gear-meta">
                当前操作方式：<strong>{MODE_LABEL[gear.mode]}</strong>
                {gear.isolated && " · 自动 / 随动已锁定，应急可接管"}
              </p>
              <div className="mode-row">
                {OPERATION_MODES.map((mode) => {
                  const block = modeSelectionBlock(gear, mode.id);
                  const active = gear.mode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      className={`mode-btn ${active ? "active" : ""}`}
                      disabled={block !== null}
                      title={block ?? `切换为${mode.label}`}
                      onClick={() => handleSelectMode(gear.id, mode.id)}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>

      <div className="steering-columns">
        {/* 隔离 / 恢复登记 */}
        <section className="panel">
          <div className="heading">
            <div>
              <p>试验登记</p>
              <h2>隔离 / 恢复申请</h2>
            </div>
          </div>
          <div className="field-grid">
            <label>
              <span>舵机</span>
              <select
                value={form.gearId}
                onChange={(e) => updateForm({ gearId: e.target.value as GearId })}
              >
                {ledger.gears.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>申请类型</span>
              <select
                value={form.kind}
                onChange={(e) => updateForm({ kind: e.target.value as ApplicationKind })}
              >
                <option value="isolate">申请隔离</option>
                <option value="restore">申请恢复</option>
              </select>
            </label>
            <label>
              <span>班次</span>
              <select value={form.shift} onChange={(e) => updateForm({ shift: e.target.value })}>
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
                onChange={(e) => updateForm({ responsible: e.target.value })}
              />
            </label>
            <label>
              <span>左满舵实测角度（°）</span>
              <input
                type="number"
                step="0.1"
                value={form.portFullAngleDeg}
                placeholder={`≥ ${REQUIRED_FULL_RUDDER_ANGLE_DEG}`}
                onChange={(e) => updateForm({ portFullAngleDeg: e.target.value })}
              />
            </label>
            <label>
              <span>右满舵实测角度（°）</span>
              <input
                type="number"
                step="0.1"
                value={form.starboardFullAngleDeg}
                placeholder={`≥ ${REQUIRED_FULL_RUDDER_ANGLE_DEG}`}
                onChange={(e) => updateForm({ starboardFullAngleDeg: e.target.value })}
              />
            </label>
            <label>
              <span>左满舵到位时间（秒）</span>
              <input
                type="number"
                step="0.1"
                value={form.portArrivalSec}
                placeholder="如 25.0"
                onChange={(e) => updateForm({ portArrivalSec: e.target.value })}
              />
            </label>
            <label>
              <span>右满舵到位时间（秒）</span>
              <input
                type="number"
                step="0.1"
                value={form.starboardArrivalSec}
                placeholder={`与左舷差 ≤ ${MAX_ARRIVAL_TIME_DIFF_SEC} 秒`}
                onChange={(e) => updateForm({ starboardArrivalSec: e.target.value })}
              />
            </label>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="primary"
              disabled={selectedGearPending}
              title={selectedGearPending ? "该舵机已有待复核申请，不能重复提交" : "提交登记"}
              onClick={handleSubmit}
            >
              提交登记
            </button>
            {selectedGearPending && (
              <span className="inline-hint">该舵机已有待复核申请，不能重复提交</span>
            )}
          </div>
        </section>

        {/* 交接摘要 */}
        <section className="panel summary-panel">
          <div className="heading">
            <div>
              <p>交接摘要</p>
              <h2>未解除设备与卡住项</h2>
            </div>
          </div>
          <h4>未解除设备（{summary.isolatedGears.length}）</h4>
          {summary.isolatedGears.length === 0 ? (
            <p className="empty">无隔离中设备</p>
          ) : (
            <ul className="summary-list">
              {summary.isolatedGears.map((gear) => (
                <li key={gear.id}>
                  <strong>{gear.name}</strong> 隔离中，自动 / 随动不可选，应急可接管
                </li>
              ))}
            </ul>
          )}
          <h4>卡住的复测项（{summary.stuckItems.length}）</h4>
          {summary.stuckItems.length === 0 ? (
            <p className="empty">无待复核或不合格申请</p>
          ) : (
            <ul className="summary-list">
              {summary.stuckItems.map((item) => (
                <li key={item.application.id}>
                  <strong>{item.application.id}</strong> {item.gearName} ·{" "}
                  {APPLICATION_KIND_LABEL[item.application.kind]} · {item.reason}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* 待复核申请 */}
      <section className="panel">
        <div className="heading">
          <div>
            <p>复核队列</p>
            <h2>待复核申请（{pendingList.length}）</h2>
          </div>
        </div>
        {pendingList.length === 0 ? (
          <p className="empty">暂无待复核申请</p>
        ) : (
          <div className="records">
            {pendingList.map((app) => (
              <article key={app.id}>
                <b>{app.id.replace("SG-", "")}</b>
                <div>
                  <h3>
                    {ledger.gears.find((g) => g.id === app.gearId)?.name} ·{" "}
                    {APPLICATION_KIND_LABEL[app.kind]} · {app.shift}
                  </h3>
                  <p>
                    责任人：{app.responsible.trim() || "（未填写）"} · 左满舵{" "}
                    {app.portFullAngleDeg ?? "—"}° / 右满舵 {app.starboardFullAngleDeg ?? "—"}° ·
                    到位 {app.portArrivalSec ?? "—"}s / {app.starboardArrivalSec ?? "—"}s · 登记于{" "}
                    {formatTime(app.submittedAt)}
                  </p>
                </div>
                <button type="button" className="primary" onClick={() => handleReview(app.id)}>
                  复核判定
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 试验台账 */}
      <section className="panel">
        <div className="heading">
          <div>
            <p>试验台账</p>
            <h2>全部登记记录（{ledger.applications.length}）</h2>
          </div>
        </div>
        {ledger.applications.length === 0 ? (
          <p className="empty">台账暂无记录</p>
        ) : (
          <div className="table-wrap">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>编号</th>
                  <th>舵机</th>
                  <th>类型</th>
                  <th>班次</th>
                  <th>责任人</th>
                  <th>左/右满舵（°）</th>
                  <th>左/右到位（秒）</th>
                  <th>登记时间</th>
                  <th>结论</th>
                </tr>
              </thead>
              <tbody>
                {ledger.applications.map((app) => (
                  <tr key={app.id}>
                    <td>{app.id}</td>
                    <td>{ledger.gears.find((g) => g.id === app.gearId)?.name}</td>
                    <td>{APPLICATION_KIND_LABEL[app.kind]}</td>
                    <td>{app.shift}</td>
                    <td>{app.responsible.trim() || "（未填写）"}</td>
                    <td>
                      {app.portFullAngleDeg ?? "—"} / {app.starboardFullAngleDeg ?? "—"}
                    </td>
                    <td>
                      {app.portArrivalSec ?? "—"} / {app.starboardArrivalSec ?? "—"}
                    </td>
                    <td>{formatTime(app.submittedAt)}</td>
                    <td>
                      <span className={`badge status-${app.status}`}>
                        {APPLICATION_STATUS_LABEL[app.status]}
                      </span>
                      {app.defects.length > 0 && (
                        <ul className="defects">
                          {app.defects.map((defect) => (
                            <li key={defect}>{defect}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
