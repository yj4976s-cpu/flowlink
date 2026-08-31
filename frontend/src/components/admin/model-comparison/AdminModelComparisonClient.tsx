"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/common/Icon";
import {
  getAdminModelComparison,
  type AdminModelClassMetric,
  type AdminModelComparison,
  type AdminModelComparisonModel,
} from "@/lib/adminModelComparisonApi";
import {
  classComparisonStatus,
  classMetricByCode,
  currentModelLabel,
  fileSizeLabel,
  metricDelta,
  metricLabel,
} from "./modelComparisonViewState";
import styles from "./AdminModelComparisonClient.module.css";

type MetricKey = "precision" | "recall" | "map50" | "map50_95" | "average_inference_ms" | "fps" | "file_size_bytes";

const CLASS_ORDER = ["BALL", "FOOTWEAR", "TRASH", "HAT"];

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

export function AdminModelComparisonClient() {
  const [data, setData] = useState<AdminModelComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  if (loading) return <main className={styles.page}><State loading /></main>;
  if (error) return <main className={styles.page}><State error={error} /></main>;
  if (!data || data.models.length < 2) {
    return <main className={styles.page}><State error="비교할 모델 평가 데이터가 아직 충분하지 않습니다." /></main>;
  }

  return <ModelComparison data={data} />;
}

function ModelComparison({ data }: { data: AdminModelComparison }) {
  const [previous, current] = data.models;
  const currentDeployed = currentModelLabel(data.models, data.current_deployed_model_id, data.current_deployed_model_status);
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
        <span>기존 3클래스 모델과 HAT가 추가된 신규 4클래스 모델의 사전 평가 JSON을 비교합니다.</span>
      </div>
      <Link href="/admin/ai-report">AI 리포트로 돌아가기 <Icon name="arrow" size={13} /></Link>
    </header>

    <section className={styles.notice} role="note">
      <Icon name="info" size={18} />
      <p>이 화면은 사전 평가 결과를 읽는 관리자 전용 화면이며, 실시간 모델 전환 화면이 아닙니다. 웹 요청 중 YOLO 모델을 로딩하지 않습니다. 동일 테스트셋 결과만 직접 비교할 수 있으며, mAP와 매칭 점수는 소유권 확률이 아닙니다.</p>
    </section>

    <section className={styles.summaryGrid} aria-label="모델 비교 요약">
      <SummaryCard label="기존 모델" value={previous.display_name} note={previous.file_name} />
      <SummaryCard label="신규 HAT 모델" value={current.display_name} note={current.file_name} tone="hat" />
      <SummaryCard label="현재 배포 모델" value={currentDeployed} note="배포 모델 환경값은 이 화면에서 변경하지 않습니다" />
      <SummaryCard label="평가 생성 시각" value={dateTime(data.generated_at)} note={data.evaluation.dataset_name} />
    </section>

    <section className={styles.metrics} aria-label="핵심 지표 비교">
      {METRICS.map((metric) => {
        const before = metricValue(previous, metric.key);
        const after = metricValue(current, metric.key);
        const delta = metricDelta(before, after, {
          lowerIsBetter: metric.lowerIsBetter,
          percentPoint: metric.percentPoint,
        });

        return <article key={metric.key} className={styles.metric}>
          <span>{metric.label}</span>
          <div>
            <p><small>{previous.display_name}</small><strong>{metric.format(before)}</strong></p>
            <p><small>{current.display_name}</small><strong>{metric.format(after)}</strong></p>
          </div>
          <b data-tone={delta.tone}>{delta.label}</b>
        </article>;
      })}
    </section>

    <section className={styles.panel}>
      <div className={styles.panelTitle}>
        <span>CLASS PERFORMANCE</span>
        <h2>클래스별 성능</h2>
        <p>HAT는 기존 모델에 없는 신규 클래스이므로 0점이 아니라 미지원/N/A로 표시합니다.</p>
      </div>
      <div className={styles.classTable} role="table" aria-label="클래스별 모델 성능 비교">
        <div role="row" className={styles.tableHead}>
          <span role="columnheader">클래스</span>
          <span role="columnheader">기존 모델</span>
          <span role="columnheader">신규 모델</span>
          <span role="columnheader">변화</span>
        </div>
        {classRows.map(({ code, before, after }) => <ClassRow key={code} code={code} before={before} after={after} />)}
      </div>
    </section>

    <section className={styles.split}>
      <TrainingCard model={previous} />
      <TrainingCard model={current} highlight />
    </section>

    <section className={styles.panel}>
      <div className={styles.panelTitle}>
        <span>EVALUATION BASIS</span>
        <h2>평가 기준</h2>
      </div>
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
      <div className={styles.panelTitle}>
        <span>EXAMPLES</span>
        <h2>이미지·영상 예시</h2>
      </div>
      {current.example_results.length ? (
        <div className={styles.examples}>{current.example_results.map((example) => <article key={example.title}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={example.media_url} alt={example.title} />
          <strong>{example.title}</strong>
          {example.description && <span>{example.description}</span>}
        </article>)}</div>
      ) : (
        <p className={styles.empty}>등록된 예시 결과가 없습니다.</p>
      )}
    </section>
  </main>;
}

function SummaryCard({ label, value, note, tone }: { label: string; value: string; note: string; tone?: string }) {
  return <article className={styles.summaryCard} data-tone={tone}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function ClassRow({ code, before, after }: { code: string; before?: AdminModelClassMetric; after?: AdminModelClassMetric }) {
  const status = classComparisonStatus(before, after);
  const label = after?.label ?? before?.label ?? code;

  return <div role="row" className={styles.classRow} data-hat={code === "HAT" || undefined}>
    <span role="cell"><strong>{label}</strong><small>{code}</small></span>
    <MetricCell metric={before} />
    <MetricCell metric={after} />
    <b role="cell" data-tone={status.tone}>{status.label}</b>
  </div>;
}

function MetricCell({ metric }: { metric?: AdminModelClassMetric }) {
  if (!metric?.supported) return <span role="cell" className={styles.unsupported}>미지원</span>;

  return <span role="cell" className={styles.metricCell}>
    <small>Precision {metricLabel(metric.precision, { percent: true })}</small>
    <small>Recall {metricLabel(metric.recall, { percent: true })}</small>
    <strong>mAP@50 {metricLabel(metric.map50, { percent: true })}</strong>
  </span>;
}

function TrainingCard({ model, highlight = false }: { model: AdminModelComparisonModel; highlight?: boolean }) {
  return <section className={styles.panel} data-highlight={highlight || undefined}>
    <div className={styles.panelTitle}>
      <span>TRAINING SETUP</span>
      <h2>{model.display_name}</h2>
    </div>
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
    {loading ? (
      <>
        <div><i /><i /><i /></div>
        <strong>모델 비교 데이터를 불러오고 있습니다.</strong>
      </>
    ) : (
      <>
        <Icon name="info" size={26} />
        <strong>{error}</strong>
      </>
    )}
  </section>;
}
