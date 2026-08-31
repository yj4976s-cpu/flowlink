"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { Icon } from "@/components/common/Icon";
import {
  activateAdminModel,
  getAdminModelComparison,
  getAdminModelDeployment,
  getAdminModelDeploymentHistory,
  rollbackAdminModel,
  type AdminModelClassMetric,
  type AdminModelComparison,
  type AdminModelComparisonModel,
  type AdminModelDeploymentEvent,
  type AdminModelDeploymentStatus,
} from "@/lib/adminModelComparisonApi";
import { createRequestId } from "@/lib/requestId";
import {
  classComparisonStatus,
  classMetricByCode,
  currentModelLabel,
  fileSizeLabel,
  isMeasuredNumber,
  metricDelta,
  metricBarViewState,
  metricRatioViewState,
  metricLabel,
} from "./modelComparisonViewState";
import styles from "./AdminModelComparisonClient.module.css";

type MetricKey = "precision" | "recall" | "map50" | "map50_95" | "average_inference_ms" | "fps" | "file_size_bytes";

const CLASS_ORDER = ["BALL", "FOOTWEAR", "TRASH", "HAT"];
const RADAR_METRICS: Array<{ key: MetricKey; label: string }> = [
  { key: "precision", label: "Precision" },
  { key: "recall", label: "Recall" },
  { key: "map50", label: "mAP@50" },
  { key: "map50_95", label: "mAP@50:95" },
];
const PERFORMANCE_METRICS: Array<{
  key: MetricKey;
  label: string;
  shortLabel: string;
  lowerIsBetter?: boolean;
  percentPoint?: boolean;
  format: (value: number | null) => string;
}> = [
  { key: "precision", label: "Precision", shortLabel: "Precision", percentPoint: true, format: (value) => metricLabel(value, { percent: true }) },
  { key: "recall", label: "Recall", shortLabel: "Recall", percentPoint: true, format: (value) => metricLabel(value, { percent: true }) },
  { key: "map50", label: "mAP@50", shortLabel: "mAP50", percentPoint: true, format: (value) => metricLabel(value, { percent: true }) },
  { key: "map50_95", label: "mAP@50:95", shortLabel: "mAP95", percentPoint: true, format: (value) => metricLabel(value, { percent: true }) },
  { key: "average_inference_ms", label: "평균 추론 시간", shortLabel: "Latency", lowerIsBetter: true, format: (value) => metricLabel(value, { suffix: "ms" }) },
  { key: "fps", label: "FPS", shortLabel: "FPS", format: (value) => metricLabel(value, { suffix: "fps" }) },
];
type PerformanceMetric = typeof PERFORMANCE_METRICS[number];
type MetricChartRow = {
  metric: PerformanceMetric;
  before: number | null;
  after: number | null;
  beforeRatio: number | null;
  afterRatio: number | null;
  delta: ReturnType<typeof metricDelta>;
};

const METRICS: Array<{
  key: MetricKey;
  label: string;
  lowerIsBetter?: boolean;
  percentPoint?: boolean;
  format: (value: number | null) => string;
}> = [
  { key: "precision", label: "Precision", percentPoint: true, format: (value) => metricLabel(value, { percent: true }) },
  { key: "recall", label: "Recall", percentPoint: true, format: (value) => metricLabel(value, { percent: true }) },
  { key: "map50", label: "mAP@50", percentPoint: true, format: (value) => metricLabel(value, { percent: true }) },
  { key: "map50_95", label: "mAP@50:95", percentPoint: true, format: (value) => metricLabel(value, { percent: true }) },
  { key: "average_inference_ms", label: "평균 추론 시간", lowerIsBetter: true, format: (value) => metricLabel(value, { suffix: "ms" }) },
  { key: "fps", label: "FPS", format: (value) => metricLabel(value, { suffix: "fps" }) },
  { key: "file_size_bytes", label: "모델 크기", lowerIsBetter: true, format: fileSizeLabel },
];

function isAbortError(reason: unknown) {
  return reason instanceof DOMException && reason.name === "AbortError";
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function metricValue(model: AdminModelComparisonModel, key: MetricKey) {
  if (key === "file_size_bytes") return model.file_size_bytes;
  return model[key];
}

function completedMetricCount(model: AdminModelComparisonModel) {
  return METRICS.filter((metric) => isMeasuredNumber(metricValue(model, metric.key))).length;
}

function classAccent(code: string) {
  if (code === "HAT") return "hat";
  if (code === "TRASH") return "trash";
  if (code === "FOOTWEAR") return "footwear";
  return "ball";
}

function modelById(models: AdminModelComparisonModel[], modelId: string | null) {
  return modelId ? models.find((model) => model.id === modelId) ?? null : null;
}

function hasMissingMetrics(model: AdminModelComparisonModel | null) {
  return Boolean(model && [model.precision, model.recall, model.map50, model.map50_95].some((value) => !isMeasuredNumber(value)));
}

function supportedClassCount(model: AdminModelComparisonModel) {
  const supported = CLASS_ORDER.filter((code) => classMetricByCode(model, code)?.supported || model.classes.includes(code)).length;
  return { supported, total: CLASS_ORDER.length, percent: Math.round(supported / CLASS_ORDER.length * 100) };
}

function measuredMetricCount(model: AdminModelComparisonModel) {
  const measured = RADAR_METRICS.filter((metric) => isMeasuredNumber(metricValue(model, metric.key))).length;
  return { measured, total: RADAR_METRICS.length, percent: Math.round(measured / RADAR_METRICS.length * 100) };
}

function chartRatio(value: number | null, max: number) {
  return metricRatioViewState(value, max).ratio;
}

function classSupportState(metric: AdminModelClassMetric | undefined) {
  if (!metric?.supported) return { label: "미지원", tone: "missing" };
  if ([metric.precision, metric.recall, metric.map50, metric.map50_95].some(isMeasuredNumber)) return { label: "측정 완료", tone: "better" };
  return { label: "측정 전", tone: "neutral" };
}

export function AdminModelComparisonClient() {
  const [data, setData] = useState<AdminModelComparison | null>(null);
  const [deployment, setDeployment] = useState<AdminModelDeploymentStatus | null>(null);
  const [history, setHistory] = useState<AdminModelDeploymentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deploymentLoading, setDeploymentLoading] = useState(true);
  const [deploymentError, setDeploymentError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"ACTIVATE" | "ROLLBACK" | null>(null);
  const [notice, setNotice] = useState("");
  const deploymentRequestRef = useRef(0);
  const activationTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getAdminModelComparison(controller.signal)
      .then(setData)
      .catch((reason: unknown) => {
        if (!isAbortError(reason)) {
          setError(reason instanceof Error ? reason.message : "모델 비교 데이터를 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  const loadDeployment = (signal?: AbortSignal) => {
    const requestIndex = ++deploymentRequestRef.current;
    setDeploymentLoading(true);
    setDeploymentError("");
    setHistoryLoading(true);
    setHistoryError("");

    const runtimeRequest = getAdminModelDeployment(signal)
      .then((status) => {
        if (requestIndex !== deploymentRequestRef.current || signal?.aborted) return;
        setDeployment(status);
      })
      .catch((reason: unknown) => {
        if (!isAbortError(reason) && requestIndex === deploymentRequestRef.current) {
          setDeployment(null);
          setDeploymentError(reason instanceof Error ? reason.message : "실시간 모델 상태를 확인하지 못했습니다.");
        }
      })
      .finally(() => {
        if (requestIndex === deploymentRequestRef.current && !signal?.aborted) setDeploymentLoading(false);
      });

    const historyRequest = getAdminModelDeploymentHistory(signal)
      .then((historyPayload) => {
        if (requestIndex !== deploymentRequestRef.current || signal?.aborted) return;
        setHistory(historyPayload.events);
      })
      .catch((reason: unknown) => {
        if (!isAbortError(reason) && requestIndex === deploymentRequestRef.current) {
          setHistoryError(reason instanceof Error ? reason.message : "모델 전환 이력을 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (requestIndex === deploymentRequestRef.current && !signal?.aborted) setHistoryLoading(false);
      });

    return Promise.allSettled([runtimeRequest, historyRequest]);
  };

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadDeployment(controller.signal));
    return () => controller.abort();
  }, []);

  const activate = (modelId: string) => {
    if (busyAction || !deployment || deployment.active_model_id === modelId) return;
    let requestId: string;
    try {
      requestId = createRequestId();
    } catch {
      setNotice("보안 요청 ID를 만들 수 없어 모델 전환을 시작하지 않았습니다. 브라우저 보안 설정을 확인해 주세요.");
      return;
    }
    setBusyAction("ACTIVATE");
    setNotice("");
    activateAdminModel(modelId, deployment.active_model_id, requestId)
      .then(() => {
        setPendingModelId(null);
        setNotice("모델 전환이 완료되었습니다. 이후 새 분석부터 활성 모델이 적용됩니다.");
        return loadDeployment();
      })
      .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "모델 전환에 실패했습니다. 기존 모델은 유지됩니다."))
      .finally(() => {
        setBusyAction(null);
        window.setTimeout(() => activationTriggerRef.current?.focus(), 0);
      });
  };

  const rollback = () => {
    if (busyAction || !deployment?.rollback_available) return;
    let requestId: string;
    try {
      requestId = createRequestId();
    } catch {
      setNotice("보안 요청 ID를 만들 수 없어 롤백을 시작하지 않았습니다. 브라우저 보안 설정을 확인해 주세요.");
      return;
    }
    setBusyAction("ROLLBACK");
    setNotice("");
    rollbackAdminModel(deployment.active_model_id, requestId)
      .then(() => {
        setNotice("직전 모델로 롤백했습니다.");
        return loadDeployment();
      })
      .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : "모델 롤백에 실패했습니다. 기존 모델은 유지됩니다."))
      .finally(() => setBusyAction(null));
  };

  if (loading) return <main className={styles.page}><State loading /></main>;
  if (error) return <main className={styles.page}><State error={error} /></main>;
  if (!data || data.models.length < 2) {
    return <main className={styles.page}><State error="비교할 모델 평가 데이터가 아직 충분하지 않습니다." /></main>;
  }

  return <ModelComparison
    data={data}
    deployment={deployment}
    deploymentLoading={deploymentLoading}
    deploymentError={deploymentError}
    historyLoading={historyLoading}
    historyError={historyError}
    history={history}
    pendingModelId={pendingModelId}
    busyAction={busyAction}
    notice={notice}
    onRefreshDeployment={() => void loadDeployment()}
    onRequestActivate={(modelId, trigger) => {
      activationTriggerRef.current = trigger;
      setPendingModelId(modelId);
    }}
    onCancelActivate={() => {
      setPendingModelId(null);
      window.setTimeout(() => activationTriggerRef.current?.focus(), 0);
    }}
    onConfirmActivate={activate}
    onRollback={rollback}
  />;
}

function ModelComparison(props: {
  data: AdminModelComparison;
  deployment: AdminModelDeploymentStatus | null;
  deploymentLoading: boolean;
  deploymentError: string;
  historyLoading: boolean;
  historyError: string;
  history: AdminModelDeploymentEvent[];
  pendingModelId: string | null;
  busyAction: "ACTIVATE" | "ROLLBACK" | null;
  notice: string;
  onRefreshDeployment: () => void;
  onRequestActivate: (modelId: string, trigger: HTMLButtonElement) => void;
  onCancelActivate: () => void;
  onConfirmActivate: (modelId: string) => void;
  onRollback: () => void;
}) {
  const { data, deployment, deploymentLoading, deploymentError, historyLoading, historyError, history, pendingModelId, busyAction, notice, onRefreshDeployment, onRequestActivate, onCancelActivate, onConfirmActivate, onRollback } = props;
  const [previous, current] = data.models;
  const jsonDeployed = currentModelLabel(data.models, data.current_deployed_model_id, data.current_deployed_model_status);
  const runtimeModel = modelById(data.models, deployment?.active_model_id ?? null);
  const jsonRuntimeMismatch = Boolean(
    data.current_deployed_model_id
    && deployment?.active_model_id
    && data.current_deployed_model_id !== deployment.active_model_id,
  );
  const pendingModel = modelById(data.models, pendingModelId);
  const classRows = useMemo(() => CLASS_ORDER.map((code) => ({
    code,
    before: classMetricByCode(previous, code),
    after: classMetricByCode(current, code),
  })), [current, previous]);

  return <main className={styles.page}>
    <header className={styles.intro}>
      <div>
        <p>ADMIN · MODEL COMPARISON</p>
        <h1>모델 비교</h1>
        <span>기존 3클래스 모델과 HAT가 추가된 신규 4클래스 모델을 사전 평가 JSON으로 비교합니다.</span>
      </div>
      <Link href="/admin/ai-report">AI 리포트로 돌아가기 <Icon name="arrow" size={13} /></Link>
    </header>

    <DeploymentPanel
      models={data.models}
      deployment={deployment}
      deploymentLoading={deploymentLoading}
      deploymentError={deploymentError}
      runtimeModel={runtimeModel}
      jsonRuntimeMismatch={jsonRuntimeMismatch}
      notice={notice}
      busyAction={busyAction}
      onRefresh={onRefreshDeployment}
      onRequestActivate={onRequestActivate}
      onRollback={onRollback}
    />

    <section className={styles.notice} role="note">
      <Icon name="info" size={18} />
      <p>이 화면은 사전 평가 결과를 확인하고 운영 모델을 안전하게 전환하는 관리자 화면이며, 웹 요청마다 추론하는 실시간 모델 전환 화면이 아닙니다. 실제 운영 모델의 기준은 Backend-AI 런타임 상태입니다. 모델 전환은 버튼을 눌렀을 때만 후보 모델을 로드·검증하며, 진행 중인 분석은 시작 당시 모델로 완료됩니다. mAP와 매칭 점수는 소유권 확률이 아닙니다.</p>
    </section>

    <section className={styles.modelHero} aria-label="모델 비교 요약">
      <ModelCard model={previous} label="기존 3클래스" measured={completedMetricCount(previous)} />
      <div className={styles.compareBadge} aria-hidden="true"><span>VS</span><i /></div>
      <ModelCard model={current} label="신규 HAT 4클래스" measured={completedMetricCount(current)} highlight />
      <aside className={styles.deployCard}>
        <span>평가 JSON의 배포 메모</span>
        <strong>{jsonDeployed}</strong>
        <small>실제 운영 모델은 위 런타임 상태를 기준으로 확인하세요. 평가 생성 {dateTime(data.generated_at)} · {data.evaluation.dataset_name}</small>
      </aside>
    </section>

    <VisualComparisonPanel previous={previous} current={current} />

    <MetricComparisonPanel previous={previous} current={current} />

    <section className={styles.panel}>
      <div className={styles.panelTitle}><span>CLASS PERFORMANCE</span><h2>클래스별 성능</h2><p>HAT는 기존 모델에 없는 신규 클래스이므로 0점이 아니라 미지원으로 표시합니다.</p></div>
      <div className={styles.classCards} role="list" aria-label="클래스별 모델 성능 비교">
        {classRows.map(({ code, before, after }) => <ClassCard key={code} code={code} before={before} after={after} />)}
      </div>
    </section>

    <section className={styles.split}>
      <TrainingCard model={previous} />
      <TrainingCard model={current} highlight />
    </section>

    <section className={styles.panel}>
      <div className={styles.panelTitle}><span>EVALUATION BASIS</span><h2>평가 기준</h2></div>
      <dl className={styles.evalGrid}>
        <Info label="Dataset" value={data.evaluation.dataset_name} />
        <Info label="Version" value={data.evaluation.dataset_version ?? "확인 필요"} />
        <Info label="Test images" value={data.evaluation.test_image_count == null ? "확인 필요" : `${data.evaluation.test_image_count}장`} />
        <Info label="Image size" value={data.evaluation.image_size == null ? "확인 필요" : `${data.evaluation.image_size}px`} />
        <Info label="Confidence" value={data.evaluation.confidence_threshold == null ? "확인 필요" : String(data.evaluation.confidence_threshold)} />
        <Info label="IoU" value={data.evaluation.iou_threshold == null ? "확인 필요" : String(data.evaluation.iou_threshold)} />
        <Info label="Batch" value={data.evaluation.batch == null ? "확인 필요" : String(data.evaluation.batch)} />
        <Info label="Device" value={data.evaluation.device ?? "확인 필요"} />
        <Info label="Ultralytics" value={data.evaluation.ultralytics_version ?? "확인 필요"} />
      </dl>
      {data.evaluation.notes && <p className={styles.notes}>{data.evaluation.notes}</p>}
    </section>

    <section className={styles.panel}>
      <div className={styles.panelTitle}><span>EXAMPLES</span><h2>이미지·영상 예시</h2></div>
      {current.example_results.length ? (
        <div className={styles.examples}>{current.example_results.map((example) => <article key={example.title}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={example.media_url} alt={example.title} />
          <strong>{example.title}</strong>
          {example.description && <span>{example.description}</span>}
        </article>)}</div>
      ) : <p className={styles.empty}>등록된 예시 결과가 없습니다.</p>}
    </section>

    <DeploymentHistory history={history} loading={historyLoading} error={historyError} />

    {pendingModel && (
      <ConfirmActivateModal
        current={runtimeModel}
        target={pendingModel}
        busy={busyAction === "ACTIVATE"}
        onCancel={onCancelActivate}
        onConfirm={() => onConfirmActivate(pendingModel.id)}
      />
    )}
  </main>;
}

function DeploymentPanel(props: {
  models: AdminModelComparisonModel[];
  deployment: AdminModelDeploymentStatus | null;
  deploymentLoading: boolean;
  deploymentError: string;
  runtimeModel: AdminModelComparisonModel | null;
  jsonRuntimeMismatch: boolean;
  notice: string;
  busyAction: "ACTIVATE" | "ROLLBACK" | null;
  onRefresh: () => void;
  onRequestActivate: (modelId: string, trigger: HTMLButtonElement) => void;
  onRollback: () => void;
}) {
  const { models, deployment, deploymentLoading, deploymentError, runtimeModel, jsonRuntimeMismatch, notice, busyAction, onRefresh, onRequestActivate, onRollback } = props;
  return <section className={`${styles.panel} ${styles.deploymentPanel}`} aria-label="실제 운영 모델 제어">
    <div className={styles.deploymentHead}>
      <div className={styles.panelTitle}><span>RUNTIME CONTROL</span><h2>실제 운영 모델</h2><p>Backend-AI가 현재 사용 중인 모델을 조회하고, 등록된 후보 모델로만 안전하게 전환합니다.</p></div>
      <div className={styles.deploymentActions}>
        <button type="button" onClick={onRefresh} disabled={deploymentLoading || Boolean(busyAction)}>{deploymentLoading ? "확인 중" : "상태 새로고침"}</button>
        <button type="button" onClick={onRollback} disabled={!deployment?.rollback_available || Boolean(busyAction)}>{busyAction === "ROLLBACK" ? "롤백 중" : "직전 모델 롤백"}</button>
      </div>
    </div>
    {deploymentError ? <p className={styles.deploymentError} role="alert">실시간 상태 확인 실패 · {deploymentError}</p> : (
      <div className={styles.runtimeGrid}>
        <article><span>현재 활성 모델</span><strong>{deployment?.active_display_name ?? runtimeModel?.display_name ?? "확인 중"}</strong><small>{deployment?.active_model_id ?? "runtime 상태를 조회하는 중입니다."}</small></article>
        <article><span>모델 서비스</span><strong>{deployment?.switching ? "전환 중" : deployment?.model_ready ? "준비 완료" : "확인 필요"}</strong><small>{deployment?.switched_at ? `마지막 전환 ${dateTime(deployment.switched_at)}` : "전환 이력 없음"}</small></article>
        <article><span>활성 클래스</span><strong>{deployment?.active_classes.join(" · ") || "확인 중"}</strong><small>{deployment?.active_classes.includes("HAT") ? "HAT 지원" : "HAT 미지원 또는 확인 전"}</small></article>
      </div>
    )}
    {jsonRuntimeMismatch && <p className={styles.deploymentError} role="alert">실제 운영 모델과 평가 JSON의 배포 메모가 다릅니다. 운영 상태는 Backend-AI runtime을 기준으로 표시합니다.</p>}
    {deployment?.audit_warning && <p className={styles.deploymentError} role="alert">{deployment.audit_warning}</p>}
    {notice && <p className={styles.deploymentNotice} role="status">{notice}</p>}
    <div className={styles.runtimeModels} role="list" aria-label="전환 가능한 모델">
      {models.map((model) => {
        const runtimeInfo = deployment?.available_models.find((item) => item.id === model.id);
        const active = deployment?.active_model_id === model.id;
        const available = runtimeInfo?.available ?? false;
        return <article key={model.id} role="listitem" data-active={active || undefined}>
          <span>{runtimeInfo?.supports_hat ? "HAT 지원" : "3클래스"}</span>
          <strong>{model.display_name}</strong>
          <small>{model.classes.join(" · ")}</small>
          {hasMissingMetrics(model) && <em>동일 테스트셋 성능 평가 미등록</em>}
          <button type="button" disabled={!deployment || !available || active || Boolean(busyAction)} onClick={(event) => onRequestActivate(model.id, event.currentTarget)}>
            {active ? "운영 중" : available ? "이 모델로 전환" : "모델 파일 없음"}
          </button>
        </article>;
      })}
    </div>
  </section>;
}

function ConfirmActivateModal({ current, target, busy, onCancel, onConfirm }: { current: AdminModelComparisonModel | null; target: AdminModelComparisonModel; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const added = target.classes.filter((item) => !current?.classes.includes(item));
  const removed = current ? current.classes.filter((item) => !target.classes.includes(item)) : [];

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => cancelRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const closeIfAllowed = () => {
    if (!busy) onCancel();
  };
  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) closeIfAllowed();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeIfAllowed();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? []);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return <div className={styles.modalBackdrop} role="presentation" onClick={handleBackdropClick}>
    <section ref={dialogRef} className={styles.confirmModal} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={handleKeyDown}>
      <div className={styles.panelTitle}><span>CONFIRM SWITCH</span><h2 id={titleId}>운영 모델을 전환할까요?</h2><p id={descriptionId}>진행 중인 분석은 시작 당시 모델로 완료되고, 전환 이후 새 분석부터 선택한 모델이 적용됩니다.</p></div>
      <dl><Info label="현재 모델" value={current?.display_name ?? "확인 중"} /><Info label="전환 대상" value={target.display_name} /><Info label="추가 클래스" value={added.length ? added.join(" · ") : "없음"} /><Info label="제거 클래스" value={removed.length ? removed.join(" · ") : "없음"} /></dl>
      {hasMissingMetrics(target) && <p role="note">이 모델은 동일 테스트셋 성능 평가값이 아직 비어 있습니다. 기술 검증을 통과한 등록 모델만 전환할 수 있지만, 성능 비교는 별도 확인이 필요합니다.</p>}
      <footer><button ref={cancelRef} type="button" onClick={closeIfAllowed} disabled={busy}>취소</button><button type="button" onClick={onConfirm} disabled={busy}>{busy ? "전환 중" : "확인 후 전환"}</button></footer>
    </section>
  </div>;
}

function DeploymentHistory({ history, loading, error }: { history: AdminModelDeploymentEvent[]; loading: boolean; error: string }) {
  return <section className={styles.panel}>
    <div className={styles.panelTitle}><span>AUDIT LOG</span><h2>최근 모델 전환 이력</h2><p>관리자 요청 시각, 작업, 이전/대상 모델, 성공 여부를 확인합니다.</p></div>
    {error ? <p className={styles.deploymentError} role="alert">모델 전환 이력 확인 실패 · {error}</p> : loading ? <p className={styles.empty}>모델 전환 이력을 불러오는 중입니다.</p> : history.length ? <div className={styles.historyList}>
      {history.map((event) => <article key={event.id}>
        <span>{event.action}</span>
        <strong>{event.from_model_id ?? "없음"} → {event.to_model_id ?? event.requested_model_id ?? "확인 필요"}</strong>
        <small>{event.requester_email ?? `관리자 #${event.requested_by ?? "-"}`} · {dateTime(event.requested_at)}</small>
        <b data-status={event.status}>{event.status}{event.failure_code ? ` · ${event.failure_code}` : ""}</b>
      </article>)}
    </div> : <p className={styles.empty}>아직 모델 전환 이력이 없습니다.</p>}
  </section>;
}

function ModelCard({ model, label, measured, highlight = false }: { model: AdminModelComparisonModel; label: string; measured: number; highlight?: boolean }) {
  return <article className={styles.modelCard} data-highlight={highlight || undefined}>
    <div><span>{label}</span><strong>{model.display_name}</strong><small>{model.file_name}</small></div>
    <ul aria-label={`${model.display_name} 클래스`}>{model.classes.map((item) => <li key={item}>{item}</li>)}</ul>
    <footer><b>{measured}/{METRICS.length}</b><span>측정 지표 등록</span></footer>
  </article>;
}

function VisualComparisonPanel({ previous, current }: { previous: AdminModelComparisonModel; current: AdminModelComparisonModel }) {
  return <section className={`${styles.panel} ${styles.visualPanel}`} aria-label="모델 비교 시각 요약">
    <div className={styles.panelTitle}>
      <span>VISUAL SUMMARY</span>
      <h2>한눈에 보는 모델 변화</h2>
      <p>정확도 값은 실제 평가 JSON에 있을 때만 그립니다. 현재는 클래스 지원 범위와 모델 크기, 측정 준비도를 중심으로 비교합니다.</p>
    </div>
    <div className={styles.visualGrid}>
      <CoverageGauge model={previous} label="기존 모델" />
      <ComparisonRadar previous={previous} current={current} />
      <CoverageGauge model={current} label="신규 HAT 모델" highlight />
      <SizeComparisonBars previous={previous} current={current} />
    </div>
  </section>;
}

function CoverageGauge({ model, label, highlight = false }: { model: AdminModelComparisonModel; label: string; highlight?: boolean }) {
  const coverage = supportedClassCount(model);
  const measured = measuredMetricCount(model);
  return <article className={styles.coverageCard} data-highlight={highlight || undefined}>
    <div
      className={styles.coverageDial}
      style={{ "--coverage": `${coverage.percent}%` } as CSSProperties}
      aria-label={`${label} 클래스 지원 ${coverage.supported}/${coverage.total}`}
    >
      <strong>{coverage.supported}/{coverage.total}</strong>
      <span>classes</span>
    </div>
    <div>
      <span>{label}</span>
      <h3>{model.display_name}</h3>
      <p>{model.classes.join(" · ")}</p>
      <small>핵심 지표 {measured.measured}/{measured.total}개 측정 완료</small>
      <i aria-hidden="true"><b style={{ width: `${measured.percent}%` }} /></i>
    </div>
  </article>;
}

function ComparisonRadar({ previous, current }: { previous: AdminModelComparisonModel; current: AdminModelComparisonModel }) {
  const hasMeasured = RADAR_METRICS.some((metric) => isMeasuredNumber(metricValue(previous, metric.key)) || isMeasuredNumber(metricValue(current, metric.key)));
  return <article className={styles.radarCard}>
    <header><span>CORE METRICS</span><strong>성능 지표 레이더</strong></header>
    <svg viewBox="0 0 160 160" role="img" aria-label="Precision, Recall, mAP 성능 비교 차트">
      <g className={styles.radarGrid}>
        {[.25, .5, .75, 1].map((scale) => <polygon key={scale} points={radarPoints(() => scale)} />)}
        {RADAR_METRICS.map((metric, index) => {
          const end = radarPoint(1, index);
          return <line key={metric.key} x1="80" y1="80" x2={end.x} y2={end.y} />;
        })}
      </g>
      {hasMeasured && <g>
        <polygon className={styles.radarBefore} points={radarPoints((metric) => metricValue(previous, metric.key) ?? 0)} />
        <polygon className={styles.radarAfter} points={radarPoints((metric) => metricValue(current, metric.key) ?? 0)} />
      </g>}
      {RADAR_METRICS.map((metric, index) => {
        const point = radarPoint(1.18, index);
        return <text key={metric.key} x={point.x} y={point.y}>{metric.label.replace("mAP@", "@")}</text>;
      })}
    </svg>
    {hasMeasured ? <div className={styles.radarLegend}><span>기존</span><span>신규</span></div> : <p>Precision · Recall · mAP 평가값은 아직 측정 전입니다.</p>}
  </article>;
}

function radarPoint(value: number, index: number) {
  const angle = -Math.PI / 2 + index * (Math.PI * 2 / RADAR_METRICS.length);
  const radius = 52 * Math.max(0, Math.min(1.18, value));
  return {
    x: 80 + Math.cos(angle) * radius,
    y: 80 + Math.sin(angle) * radius,
  };
}

function radarPoints(valueFor: (metric: { key: MetricKey; label: string }, index: number) => number) {
  return RADAR_METRICS.map((metric, index) => {
    const point = radarPoint(valueFor(metric, index), index);
    return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(" ");
}

function SizeComparisonBars({ previous, current }: { previous: AdminModelComparisonModel; current: AdminModelComparisonModel }) {
  const max = Math.max(previous.file_size_bytes ?? 0, current.file_size_bytes ?? 0, 1);
  return <article className={styles.sizeCard}>
    <header><span>MODEL SIZE</span><strong>파일 크기 비교</strong></header>
    <SizeBar model={previous} max={max} />
    <SizeBar model={current} max={max} highlight />
    <p>작을수록 배포·로딩 부담이 낮습니다. 실제 정확도 비교는 평가 지표가 채워진 뒤 판단합니다.</p>
  </article>;
}

function SizeBar({ model, max, highlight = false }: { model: AdminModelComparisonModel; max: number; highlight?: boolean }) {
  const value = model.file_size_bytes;
  const width = isMeasuredNumber(value) ? Math.max(4, Math.min(100, value / max * 100)) : 0;
  return <div className={styles.sizeBar} data-highlight={highlight || undefined}>
    <span>{model.display_name}</span>
    <i aria-hidden="true"><b style={{ width: `${width}%` }} /></i>
    <strong>{fileSizeLabel(value)}</strong>
  </div>;
}

function MetricComparisonPanel({ previous, current }: { previous: AdminModelComparisonModel; current: AdminModelComparisonModel }) {
  return <section className={`${styles.panel} ${styles.metricPanel}`} aria-label="핵심 지표 비교 차트">
    <div className={styles.panelTitle}><span>METRIC DASHBOARD</span><h2>핵심 지표 비교</h2><p>측정값이 없는 지표는 측정 전으로 표시해 실제 평가값과 대기 중인 항목을 구분합니다.</p></div>
    <MetricTrendChart previous={previous} current={current} />
  </section>;
}

function MetricTrendChart({ previous, current }: { previous: AdminModelComparisonModel; current: AdminModelComparisonModel }) {
  const rows = PERFORMANCE_METRICS.map((metric) => {
    const before = metricValue(previous, metric.key);
    const after = metricValue(current, metric.key);
    const measuredValues = [before, after].filter(isMeasuredNumber);
    const max = metric.percentPoint ? 1 : Math.max(...measuredValues, 1);
    const delta = metricDelta(before, after, { lowerIsBetter: metric.lowerIsBetter, percentPoint: metric.percentPoint });
    return {
      metric,
      before,
      after,
      beforeRatio: chartRatio(before, max),
      afterRatio: chartRatio(after, max),
      delta,
    };
  });
  const measuredRows = rows.filter((row) => row.beforeRatio != null || row.afterRatio != null).length;
  const sizeMax = Math.max(previous.file_size_bytes ?? 0, current.file_size_bytes ?? 0, 1);

  return <div className={styles.metricShowcase}>
    <div className={styles.metricShowcaseCopy}>
      <span>MODEL SCOREBOARD</span>
      <strong>핵심 지표는 측정 대기, 모델 구성은 비교 완료</strong>
      <p>성능 수치는 동일 테스트셋 평가 JSON이 채워질 때만 표시합니다. 지금은 HAT 클래스 추가와 파일 크기 차이를 먼저 확인합니다.</p>
      <div className={styles.metricShowcaseLegend}>
        <span>기존 모델</span>
        <span>신규 HAT 모델</span>
      </div>
      <dl className={styles.metricShowcaseStats}>
        <div><dt>성능 지표</dt><dd>{measuredRows}/{PERFORMANCE_METRICS.length}</dd></div>
        <div><dt>기존 크기</dt><dd>{fileSizeLabel(previous.file_size_bytes)}</dd></div>
        <div><dt>신규 크기</dt><dd>{fileSizeLabel(current.file_size_bytes)}</dd></div>
      </dl>
    </div>
    <div className={styles.metricLineChart}>
      <div className={styles.metricBoardHeader}>
        <span>기존 3클래스</span>
        <strong>6개 지표 통합 차트</strong>
        <span>신규 HAT 4클래스</span>
      </div>
      <div className={styles.metricUnifiedChart}>
        <MetricSlopeSvg rows={rows} variant="desktop" />
        <MetricSlopeSvg rows={rows} variant="mobile" />
      </div>
      <div className={styles.modelSizeRibbon} aria-label="모델 파일 크기 비교">
        <SizeBar model={previous} max={sizeMax} />
        <SizeBar model={current} max={sizeMax} highlight />
      </div>
    </div>
  </div>;
}

function MetricSlopeSvg({ rows, variant }: { rows: MetricChartRow[]; variant: "desktop" | "mobile" }) {
  const compact = variant === "mobile";
  const width = compact ? 340 : 860;
  const rowGap = compact ? 72 : 46;
  const firstY = compact ? 76 : 62;
  const height = firstY + (rows.length - 1) * rowGap + (compact ? 72 : 56);
  const labelX = compact ? 20 : 24;
  const beforeX = compact ? 84 : 176;
  const afterX = compact ? 262 : 648;
  const deltaX = compact ? 320 : 820;
  const amplitude = compact ? 12 : 13;

  return <svg
    className={`${styles.metricSlopeChart} ${compact ? styles.metricSlopeChartMobile : styles.metricSlopeChartDesktop}`}
    viewBox={`0 0 ${width} ${height}`}
    role="img"
    aria-label="기존 모델과 신규 HAT 모델의 6개 핵심 지표 통합 SVG 비교 차트"
  >
    <defs>
      <linearGradient id={`metricSlopeLine-${variant}`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0%" stopColor="var(--color-primary)" />
        <stop offset="100%" stopColor="var(--color-accent)" />
      </linearGradient>
    </defs>
    <text className={styles.metricSlopeHead} x={beforeX} y="24" textAnchor="middle">기존 모델</text>
    <text className={styles.metricSlopeTitle} x={compact ? width / 2 : (beforeX + afterX) / 2} y={compact ? 46 : 24} textAnchor="middle">SVG 통합 비교</text>
    <text className={styles.metricSlopeHead} x={afterX} y="24" textAnchor="middle">신규 HAT 모델</text>
    {rows.map((row, index) => {
      const y = firstY + index * rowGap;
      const beforeMeasured = row.beforeRatio != null;
      const afterMeasured = row.afterRatio != null;
      const beforeRatio = row.beforeRatio ?? .5;
      const afterRatio = row.afterRatio ?? .5;
      const beforeY = beforeMeasured ? y + (.5 - beforeRatio) * amplitude * 2 : y;
      const afterY = afterMeasured ? y + (.5 - afterRatio) * amplitude * 2 : y;
      const missing = !beforeMeasured && !afterMeasured;
      return <g key={row.metric.key}>
        <line className={styles.metricSlopeDivider} x1={labelX} y1={y + (compact ? 35 : 26)} x2={width - labelX} y2={y + (compact ? 35 : 26)} />
        <text className={styles.metricSlopeName} x={labelX} y={compact ? y - 22 : y + 5}>{row.metric.label}</text>
        <line
          className={styles.metricSlopeTrack}
          data-empty={missing || undefined}
          x1={beforeX}
          y1={beforeY}
          x2={afterX}
          y2={afterY}
        />
        <circle className={styles.metricSlopePointBefore} data-empty={!beforeMeasured || undefined} cx={beforeX} cy={beforeY} r={compact ? 6 : 7} />
        <circle className={styles.metricSlopePointAfter} data-empty={!afterMeasured || undefined} cx={afterX} cy={afterY} r={compact ? 6 : 7} />
        {missing ? (
          <text className={styles.metricSlopePending} x={compact ? (beforeX + afterX) / 2 : afterX + 28} y={compact ? y + 24 : y + 5} textAnchor={compact ? "middle" : "start"}>측정 대기</text>
        ) : (
          <>
            <text className={styles.metricSlopeValue} x={beforeX} y={y + (compact ? 24 : 26)} textAnchor="middle">{row.metric.format(row.before)}</text>
            <text className={styles.metricSlopeValue} x={afterX} y={y + (compact ? 24 : 26)} textAnchor="middle">{row.metric.format(row.after)}</text>
            {!compact && <text className={styles.metricSlopeDelta} data-tone={row.delta.tone} x={deltaX} y={y + 5} textAnchor="end">{row.delta.label}</text>}
          </>
        )}
      </g>;
    })}
  </svg>;
}

function ClassCard({ code, before, after }: { code: string; before?: AdminModelClassMetric; after?: AdminModelClassMetric }) {
  const status = classComparisonStatus(before, after);
  const label = after?.label ?? before?.label ?? code;
  return <article className={styles.classCard} data-accent={classAccent(code)} role="listitem">
    <header><span><strong>{label}</strong><small>{code}</small></span><b data-tone={status.tone}>{status.label}</b></header>
    <ClassMiniChart before={before} after={after} />
    <div className={styles.classCompare}><div><em>기존 모델</em><MetricCell metric={before} /></div><div><em>신규 모델</em><MetricCell metric={after} /></div></div>
  </article>;
}

function ClassMiniChart({ before, after }: { before?: AdminModelClassMetric; after?: AdminModelClassMetric }) {
  const beforeState = classSupportState(before);
  const afterState = classSupportState(after);
  const beforeWidth = before?.supported ? Math.max(10, metricBarViewState(before.map50, 1).width) : 0;
  const afterWidth = after?.supported ? Math.max(10, metricBarViewState(after.map50, 1).width) : 0;
  return <div className={styles.classMiniChart} aria-label={`기존 모델 ${beforeState.label}, 신규 모델 ${afterState.label}`}>
    <div data-tone={beforeState.tone}>
      <span>기존</span>
      <i aria-hidden="true"><b style={{ width: `${beforeWidth}%` }} /></i>
      <strong>{beforeState.label}</strong>
    </div>
    <div data-tone={afterState.tone}>
      <span>신규</span>
      <i aria-hidden="true"><b style={{ width: `${afterWidth}%` }} /></i>
      <strong>{afterState.label}</strong>
    </div>
  </div>;
}

function MetricCell({ metric }: { metric?: AdminModelClassMetric }) {
  if (!metric?.supported) return <span className={styles.unsupported}>미지원</span>;
  return <span className={styles.metricCell}>
    <small>Precision {metricLabel(metric.precision, { percent: true })}</small>
    <small>Recall {metricLabel(metric.recall, { percent: true })}</small>
    <strong>mAP@50 {metricLabel(metric.map50, { percent: true })}</strong>
    <small>mAP@50:95 {metricLabel(metric.map50_95, { percent: true })}</small>
  </span>;
}

function TrainingCard({ model, highlight = false }: { model: AdminModelComparisonModel; highlight?: boolean }) {
  return <section className={styles.panel} data-highlight={highlight || undefined}>
    <div className={styles.panelTitle}><span>TRAINING SETUP</span><h2>{model.display_name}</h2></div>
    <dl className={styles.trainGrid}>
      <Info label="Architecture" value={model.architecture ?? "확인 필요"} />
      <Info label="Optimizer" value={model.optimizer ?? "확인 필요"} />
      <Info label="Epochs" value={model.epochs == null ? "확인 필요" : String(model.epochs)} />
      <Info label="Image size" value={model.image_size == null ? "확인 필요" : `${model.image_size}px`} />
      <Info label="Batch size" value={model.batch_size == null ? "확인 필요" : String(model.batch_size)} />
      <Info label="Classes" value={model.classes.join(" · ")} />
    </dl>
    {model.notes && <p className={styles.notes}>{model.notes}</p>}
  </section>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function State({ loading = false, error }: { loading?: boolean; error?: string }) {
  return <section className={styles.state} role={error ? "alert" : "status"}>
    {loading ? <><div><i /><i /><i /></div><strong>모델 비교 데이터를 불러오고 있습니다.</strong></> : <><Icon name="info" size={26} /><strong>{error}</strong></>}
  </section>;
}
