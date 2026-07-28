const state = {
  experimentId: null,
  mode: "both",
  modeLocked: false,
  busy: false,
  latestRuns: { baseline: null, optimized: null },
  selectedValues: [],
};

const VALUES_DATA = [
  { number: 1, nameKo: "정의", nameEn: "Justice", definition: "행동의 올바름, 공정함, 합리성" },
  { number: 2, nameKo: "기쁨", nameEn: "Pleasure", definition: "좋아하는 것에서 얻는 즐거움 및 만족감" },
  { number: 3, nameKo: "사랑", nameEn: "Love", definition: "다른 사람을 조건없이 받아들이는 사심 없는 헌신" },
  { number: 4, nameKo: "충성심", nameEn: "Loyalty", definition: "사람, 그룹, 기관 또는 신념에 대한 지속적인 충절" },
  { number: 5, nameKo: "외모", nameEn: "Physical Appearance", definition: "외적인 매력에 관심을 갖는 것" },
  { number: 6, nameKo: "미학", nameEn: "Aesthetics", definition: "아름다움과 예술적 경험을 즐기고 음미하는 것" },
  { number: 7, nameKo: "통제/영향력", nameEn: "Control / Influence", definition: "다른 사람에게 미치는 권한 또는 영향력" },
  { number: 8, nameKo: "영성/종교", nameEn: "Spirituality / Religion", definition: "신과의 교감, 신에게 귀의 및 신과 관련된 활동" },
  { number: 9, nameKo: "성취", nameEn: "Achievement", definition: "지속적인 노력을 통해 원하는 결과를 얻는 것" },
  { number: 10, nameKo: "자율성", nameEn: "Autonomy", definition: "개인의 독립성과 자기 결정권을 보장하는 것" },
  { number: 11, nameKo: "건강", nameEn: "Health", definition: "신체, 정신의 온전함" },
  { number: 12, nameKo: "정직성", nameEn: "Honesty", definition: "진솔함, 열린 마음, 행동의 공정성, 진실성" },
  { number: 13, nameKo: "열정", nameEn: "Passion", definition: "어떤 일에서 금전적 이득이나 만족보다는 '몰입하는 마음'에서 보람을 느끼는 것" },
  { number: 14, nameKo: "존엄성", nameEn: "Dignity", definition: "자신뿐 아니라 타인에게서 존중을 이끌어내는 행동과 위엄을 보여주는 것" },
  { number: 15, nameKo: "가족", nameEn: "Family", definition: "정서적으로 또는 생물학적으로 연결된 사람들" },
  { number: 16, nameKo: "인정", nameEn: "Recognition", definition: "자신이 중요하다는 느낌을 주는, 다른 사람에게서 받는 호의적인 관심과 인정" },
  { number: 17, nameKo: "부유함", nameEn: "Wealth", definition: "가치 있는 물질적 소유물과 자원이 풍부함, 경제적으로 풍요로움" },
  { number: 18, nameKo: "겸손", nameEn: "Humility", definition: "자신을 내세우지 않는 태도, 온화하고 변화에 열린 마음을 가짐" },
  { number: 19, nameKo: "창의력", nameEn: "Creativity", definition: "새로운 생각, 형식, 방법 및 행동을 내놓는 능력" },
  { number: 20, nameKo: "조화", nameEn: "Harmony", definition: "관계 속의 일체감, 주변 사람들과 갈등이 없는 상태" },
  { number: 21, nameKo: "역량/기술", nameEn: "Competency / Skill", definition: "주어진 임무를 완수하는 능력" },
  { number: 22, nameKo: "이타심", nameEn: "Altruism", definition: "타인의 요구와 가치관에 대한 적극적인 배려" },
  { number: 23, nameKo: "명예", nameEn: "Honor", definition: "두각을 나타내는 사람이 받는 존경과 위상" },
  { number: 24, nameKo: "공동체", nameEn: "Community", definition: "무엇인가에 대해 함께 마음을 쓰고 추구하는 사람들" },
  { number: 25, nameKo: "관계", nameEn: "Relationship", definition: "자신을 좋아하고 염려해주는 사람들과 함께함" },
  { number: 26, nameKo: "정서적 행복", nameEn: "Emotional Well-being", definition: "마음의 평화, 자신감, 평온함" },
  { number: 27, nameKo: "지식", nameEn: "Knowledge", definition: "배움을 통해 사실과 교훈, 원칙을 이해하고 인식하는 것" },
];

const armLabels = { baseline: "A · 공감 minimal · 로컬 원리 · 혼합 판단", optimized: "개선 Gemini · minimal · 판단 API 공유" };
const modeCopy = {
  baseline: ["공감 중 로컬 원리를 찾고, 명백한 답은 로컬로 넘기며 애매할 때만 Gemini가 판단합니다.", "A 원리 흐름으로 보내기"],
  optimized: ["개선 Gemini를 minimal thinking과 공유 판단 API로 실행합니다.", "개선 minimal 흐름으로 보내기"],
  both: ["동일 입력으로 low 기준군과 minimal 개선군을 동시에 비교합니다.", "두 파이프라인 비교하기"],
};

const $ = (selector) => document.querySelector(selector);
const id = (value) => document.getElementById(value);

function analyzerApiIsSeparate(health) {
  return health?.providers?.gemini?.profiles?.optimized?.analyzer_api_separate === true;
}

function applyHealthProfileCopy(health) {
  const analyzerRoute = analyzerApiIsSeparate(health) ? "분리" : "공유";
  armLabels.optimized = `개선 Gemini · minimal · 판단 API ${analyzerRoute}`;
  modeCopy.optimized = [
    `개선 Gemini를 minimal thinking과 ${analyzerRoute} 판단 API로 실행합니다.`,
    "개선 minimal 흐름으로 보내기",
  ];
  modeCopy.both = [
    `동일 입력으로 low 기준군과 minimal·판단 API ${analyzerRoute} 개선군을 동시에 비교합니다.`,
    "두 파이프라인 비교하기",
  ];
  id("baselineArmTag").textContent = "A · 공감 + 원리 · 혼합 판단";
  id("baselineArmLabel").textContent = armLabels.baseline;
  id("optimizedArmTag").textContent = `B · MINIMAL · 판단 API ${analyzerRoute}`;
  id("optimizedArmLabel").textContent = armLabels.optimized;
  setMode(state.mode);
}

function setFormStatus(message, error = false) {
  const target = id("formStatus");
  target.textContent = message || "";
  target.classList.toggle("is-error", error);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch (_) {}
    throw new Error(detail);
  }
  return response.status === 204 ? null : response.json();
}

async function streamApi(path, options = {}, onEvent = () => {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch (_) {}
    throw new Error(detail);
  }
  if (!response.body) throw new Error("스트리밍 응답 본문이 없습니다.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete = null;
  const consume = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    onEvent(event);
    if (event.type === "complete") complete = event;
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    lines.forEach(consume);
    if (done) break;
  }
  consume(buffer);
  if (!complete) throw new Error("상담 스트림이 최종 결과 없이 종료되었습니다.");
  return complete;
}

function setProviderStatus(arm, provider) {
  const chip = id(`${arm}Status`);
  chip.className = "status-chip";
  const connected = provider.connected;
  if (connected === true || (connected === null && provider.configured)) {
    chip.classList.add("is-ready");
    chip.innerHTML = `<i></i>${connected === true ? "연결됨" : "설정됨"}`;
  } else {
    chip.classList.add("is-error");
    chip.innerHTML = `<i></i>${provider.configured ? "연결 실패" : "설정 필요"}`;
    if (provider.error) chip.title = provider.error;
  }
  id(`${arm}ModelName`).textContent = provider.model;
}

async function loadHealth(probe = false) {
  try {
    const data = await api(`/api/health?probe=${probe}`);
    applyHealthProfileCopy(data);
    setProviderStatus("baseline", data.providers.gemini);
    setProviderStatus("optimized", data.providers.gemini);
    if (data.providers.mock_mode?.enabled) {
      setFormStatus("Mock 모드로 실행 중입니다. UI와 로그 검증용이며 실제 모델 비교 결과가 아닙니다.");
    }
  } catch (error) {
    setFormStatus(`상태 확인 실패: ${error.message}`, true);
  }
}

function appendMessage(arm, role, text, marker = "") {
  const conversation = id(`${arm}Conversation`);
  const row = document.createElement("div");
  row.className = `message ${role}${marker ? ` ${marker}` : ""}`;
  if (marker === "loading") {
    row.dataset.loading = "true";
    row.innerHTML = `<div class="bubble"><span class="dots"><i></i><i></i><i></i></span></div>`;
  } else {
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
  }
  conversation.appendChild(row);
  conversation.scrollTop = conversation.scrollHeight;
}

function removeLoading(arm) {
  id(`${arm}Conversation`).querySelectorAll("[data-loading]").forEach((node) => node.remove());
}

function removeStreamingMessage(arm) {
  id(`${arm}Conversation`).querySelectorAll("[data-streaming-message]").forEach((node) => node.remove());
}

function resetTurnArtifacts(arm) {
  removeLoading(arm);
  removeStreamingMessage(arm);
  ["First", "Total", "ModelMs", "Calls", "Retries"].forEach((suffix) => {
    id(`${arm}${suffix}`).textContent = suffix === "First" || suffix === "Total"
      ? "측정 중…"
      : "—";
  });
  id(`${arm}Rating`).hidden = true;
  renderCalls(arm, []);
  state.latestRuns[arm] = null;
}

function updateStreamedMessage(arm, event) {
  removeLoading(arm);
  const conversation = id(`${arm}Conversation`);
  let row = conversation.querySelector("[data-streaming-message]");
  if (!row) {
    row = document.createElement("div");
    row.className = "message bot";
    row.dataset.streamingMessage = "true";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    row.appendChild(bubble);
    conversation.appendChild(row);
  }
  const bubble = row.querySelector(".bubble");
  bubble.textContent = event.segment === "bridge" || event.segment === "aside"
    ? `${bubble.textContent} ${event.text}`.trim()
    : event.text;
  conversation.scrollTop = conversation.scrollHeight;
}

function isValuesStageActive() {
  const arms = activeArms();
  return arms.some((arm) => state.latestRuns[arm]?.state?.stage === "values");
}

function updateSendButtonState() {
  const sendBtn = id("sendButton");
  if (isValuesStageActive()) {
    const ready = state.selectedValues.length === 5;
    sendBtn.disabled = !ready || state.busy;
    id("sendLabel").textContent = ready ? "선택 완료하고 상담 시작하기" : `가치 5가지 선택 필요 (${state.selectedValues.length}/5)`;
  } else {
    sendBtn.disabled = state.busy;
    id("sendLabel").textContent = modeCopy[state.mode][1];
  }
}

function handleValueToggle(num, cardEl) {
  if (state.selectedValues.includes(num)) {
    state.selectedValues = state.selectedValues.filter((n) => n !== num);
    cardEl.classList.remove("selected");
  } else {
    if (state.selectedValues.length >= 5) return;
    state.selectedValues.push(num);
    cardEl.classList.add("selected");
  }

  const isMaxed = state.selectedValues.length >= 5;
  document.querySelectorAll(".value-btn-card").forEach((card) => {
    const cardNum = parseInt(card.dataset.number, 10);
    const isSelected = state.selectedValues.includes(cardNum);
    card.classList.toggle("disabled", isMaxed && !isSelected);
  });

  updateSendButtonState();
}

function renderValuesGrid() {
  const container = id("valuesGridContainer");
  if (!container) return;
  if (container.children.length > 0) {
    const isMaxed = state.selectedValues.length >= 5;
    container.querySelectorAll(".value-btn-card").forEach((card) => {
      const cardNum = parseInt(card.dataset.number, 10);
      const isSelected = state.selectedValues.includes(cardNum);
      card.classList.toggle("selected", isSelected);
      card.classList.toggle("disabled", isMaxed && !isSelected);
    });
    return;
  }

  container.replaceChildren();
  VALUES_DATA.forEach((item) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "value-btn-card";
    card.dataset.number = item.number;

    card.innerHTML = `
      <div class="card-header">
        <div class="title-group">
          <span class="card-num">${item.number}</span>
          <strong class="card-name">${item.nameKo}</strong>
          <small class="card-en">${item.nameEn}</small>
        </div>
      </div>
      <p class="card-def" title="${item.definition}">${item.definition}</p>
    `;

    card.addEventListener("click", () => handleValueToggle(item.number, card));
    container.appendChild(card);
  });
}

function checkValuesStage() {
  const active = isValuesStageActive();
  const container = id("valuesGridContainer");
  const textarea = id("messageInput");
  const label = document.querySelector('label[for="messageInput"]');
  const examples = document.querySelector(".example-list");

  if (!container) return;
  if (active) {
    container.hidden = false;
    textarea.hidden = true;
    if (label) label.textContent = "나를 설명하는 5가지 가치를 아래에서 선택해 주세요 (5개 선택 시 전송 가능)";
    if (examples) examples.style.display = "none";
    renderValuesGrid();
    updateSendButtonState();
  } else {
    container.hidden = true;
    textarea.hidden = false;
    if (label) label.textContent = "두 파이프라인에 전달할 동일한 사용자 발화";
    if (examples) examples.style.display = "flex";
    id("sendButton").disabled = state.busy;
    id("sendLabel").textContent = modeCopy[state.mode][1];
  }
}

function renderState(arm, runState) {
  const target = id(`${arm}State`);
  target.replaceChildren();
  const values = [
    `단계 ${runState.stage}`,
    `${runState.turn_count}턴`,
    runState.pending_slot ? `다음 ${runState.pending_slot}` : null,
    ...runState.filled_slots.map((slot) => `✓ ${slot}`),
  ].filter(Boolean);
  values.forEach((value) => {
    const pill = document.createElement("span");
    pill.className = "state-pill";
    pill.textContent = value;
    target.appendChild(pill);
  });
  checkValuesStage();
}

function renderCalls(arm, calls) {
  const target = id(`${arm}CallList`);
  target.replaceChildren();
  if (!calls.length) {
    const p = document.createElement("p");
    p.textContent = "이 턴에는 모델 호출이 없었습니다.";
    target.appendChild(p);
    return;
  }
  calls.forEach((call) => {
    const row = document.createElement("div");
    row.className = "call-row";
    const task = document.createElement("span");
    task.textContent = call.task;
    const duration = document.createElement("span");
    duration.textContent = `${Math.round(call.duration_ms)} ms`;
    const status = document.createElement("span");
    status.textContent = call.success ? `${call.attempts}회` : "실패";
    if (!call.success) status.className = "failed";
    row.append(task, duration, status);
    target.appendChild(row);
  });
}

function renderRating(arm, runId) {
  const wrapper = id(`${arm}Rating`);
  const buttons = wrapper.querySelector(".rating-buttons");
  buttons.replaceChildren();
  for (let score = 1; score <= 5; score += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(score);
    button.title = `${score}점`;
    button.addEventListener("click", async () => {
      try {
        await api(`/api/experiments/${state.experimentId}/ratings`, {
          method: "POST",
          body: JSON.stringify({ run_id: runId, arm, score, note: "" }),
        });
        buttons.querySelectorAll("button").forEach((node) => node.classList.remove("is-selected"));
        button.classList.add("is-selected");
        setFormStatus(`${armLabels[arm]} 답변을 ${score}점으로 기록했습니다.`);
      } catch (error) {
        setFormStatus(`평가 저장 실패: ${error.message}`, true);
      }
    });
    buttons.appendChild(button);
  }
  wrapper.hidden = false;
}

function renderRun(arm, result, observedFirstMs = null) {
  removeLoading(arm);
  const metrics = result.metrics;
  if (metrics) {
    const firstMetric = id(`${arm}First`);
    const serverFirstMs = metrics.first_response_ms ?? metrics.total_ms;
    firstMetric.textContent = `${Math.round(observedFirstMs ?? serverFirstMs)} ms`;
    firstMetric.title = observedFirstMs == null
      ? "서버가 응답을 준비한 시간"
      : `브라우저에서 처음 표시된 시간 · 서버 준비 ${Math.round(serverFirstMs)} ms`;
    id(`${arm}Total`).textContent = `${Math.round(metrics.total_ms)} ms`;
    id(`${arm}ModelMs`).textContent = `${Math.round(metrics.model_ms)} ms`;
    id(`${arm}Calls`).textContent = `${metrics.model_calls}회`;
    id(`${arm}Retries`).textContent = `${metrics.retries}회`;
  }
  if (result.state) renderState(arm, result.state);
  renderCalls(arm, result.calls || []);

  if (result.status !== "ok") {
    id(`${arm}Conversation`).querySelector("[data-streaming-message]")?.remove();
    appendMessage(arm, "bot", `실행 오류: ${result.error}`);
    state.latestRuns[arm] = result;
    return;
  }
  const streamed = id(`${arm}Conversation`).querySelector("[data-streaming-message]");
  if (streamed) {
    streamed.querySelector(".bubble").textContent = result.message;
    delete streamed.dataset.streamingMessage;
  } else {
    appendMessage(arm, "bot", result.message);
  }
  renderRating(arm, result.run_id);
  state.latestRuns[arm] = result;
}

function renderComparison(results, observedFirstByArm = {}) {
  const summary = id("comparisonSummary");
  const left = results.baseline;
  const right = results.optimized;
  if (!left || !right || left.status !== "ok" || right.status !== "ok") {
    summary.hidden = true;
    return;
  }
  const leftFirst = observedFirstByArm.baseline
    ?? left.metrics.first_response_ms
    ?? left.metrics.total_ms;
  const rightFirst = observedFirstByArm.optimized
    ?? right.metrics.first_response_ms
    ?? right.metrics.total_ms;
  const firstDelta = Math.abs(leftFirst - rightFirst);
  const firstFaster = leftFirst <= rightFirst ? armLabels.baseline : armLabels.optimized;
  const totalDelta = Math.abs(left.metrics.total_ms - right.metrics.total_ms);
  const totalFaster = left.metrics.total_ms <= right.metrics.total_ms ? armLabels.baseline : armLabels.optimized;
  summary.textContent = `브라우저 첫 표시는 ${firstFaster}이(가) ${Math.round(firstDelta)} ms 빨랐고, 서버 전체 응답은 ${totalFaster}이(가) ${Math.round(totalDelta)} ms 빨랐습니다. 답변 품질은 각 카드의 1–5점 평가로 기록해 주세요.`;
  summary.hidden = false;
}

function activeArms() {
  return state.mode === "both" ? ["baseline", "optimized"] : [state.mode];
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".segment").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  });
  document.querySelectorAll("[data-arm-card]").forEach((card) => {
    card.classList.toggle("is-muted", mode !== "both" && card.dataset.armCard !== mode);
  });
  id("modeDescription").textContent = modeCopy[mode][0];
  id("sendLabel").textContent = modeCopy[mode][1];
}

function setBusy(busy) {
  state.busy = busy;
  id("sendButton").disabled = busy;
  id("messageInput").disabled = busy;
  id("nicknameInput").disabled = busy;
  document.querySelectorAll(".segment").forEach((button) => {
    button.disabled = busy || state.modeLocked;
  });
  id("resetButton").disabled = busy;
}

async function createExperiment() {
  state.modeLocked = false;
  setBusy(true);
  setFormStatus("새 실험 세션을 준비하고 있습니다…");
  try {
    const name = id("nicknameInput").value.trim() || "사용자";
    id("nicknameInput").value = name;
    const data = await api("/api/experiments", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    state.experimentId = data.experiment_id;
    state.latestRuns = { baseline: null, optimized: null };
    id("experimentId").textContent = data.experiment_id.slice(0, 12);
    ["baseline", "optimized"].forEach((arm) => {
      const conversation = id(`${arm}Conversation`);
      conversation.replaceChildren();
      appendMessage(arm, "bot", data.greetings[arm]);
      renderState(arm, data.states[arm]);
      ["First", "Total", "ModelMs", "Calls", "Retries"].forEach((suffix) => { id(`${arm}${suffix}`).textContent = "—"; });
      id(`${arm}Rating`).hidden = true;
      renderCalls(arm, []);
    });
    id("comparisonSummary").hidden = true;
    setFormStatus("준비됐습니다. 같은 입력을 두 파이프라인에 보내 비교해 보세요.");
  } catch (error) {
    setFormStatus(`실험 생성 실패: ${error.message}`, true);
  } finally {
    setBusy(false);
    id("messageInput").focus();
  }
}

async function sendMessage() {
  if (state.busy || !state.experimentId) return;
  const input = id("messageInput");
  let message = "";

  if (isValuesStageActive()) {
    if (state.selectedValues.length !== 5) {
      setFormStatus("가치 5가지를 선택해야 다음 단계로 갈 수 있습니다.", true);
      return;
    }
    message = state.selectedValues.join(", ");
  } else {
    message = input.value.trim();
    if (!message) {
      setFormStatus("비교할 메시지를 입력해 주세요.", true);
      input.focus();
      return;
    }
  }

  const arms = activeArms();
  const requestStartedAt = performance.now();
  const observedFirstByArm = {};
  const lastSequenceByArm = {};
  const renderedArms = new Set();
  let streamComparisonId = null;
  id("comparisonSummary").hidden = true;
  arms.forEach((arm) => {
    resetTurnArtifacts(arm);
    appendMessage(arm, "user", message);
    appendMessage(arm, "bot", "", "loading");
  });
  input.value = "";
  if (isValuesStageActive()) {
    state.selectedValues = [];
  }
  setBusy(true);
  setFormStatus(`${arms.map((arm) => armLabels[arm]).join(" · ")} 실행 중…`);

  try {
    const request = { method: "POST", body: JSON.stringify({ message, arms }) };
    const data = arms.includes("baseline")
      ? await streamApi(
        `/api/experiments/${state.experimentId}/turns/stream`,
        request,
        (event) => {
          if (event.comparison_id) {
            if (streamComparisonId === null) streamComparisonId = event.comparison_id;
            if (event.comparison_id !== streamComparisonId) return;
          }
          if (event.arm && Number.isFinite(event.sequence)) {
            if (event.sequence <= (lastSequenceByArm[event.arm] || 0)) return;
            lastSequenceByArm[event.arm] = event.sequence;
          }
          if (event.type === "segment" && event.arm === "baseline") {
            if (observedFirstByArm.baseline == null) {
              observedFirstByArm.baseline = Math.round(performance.now() - requestStartedAt);
              id("baselineFirst").textContent = `${observedFirstByArm.baseline} ms`;
              id("baselineFirst").title = "브라우저에서 공감 문장을 처음 표시한 시간";
            }
            updateStreamedMessage("baseline", event);
            setFormStatus(event.segment === "bridge"
              ? "프바오가 연결 말을 건넨 뒤 다음 질문을 준비하고 있습니다…"
              : "기존 로직의 동적 공감 문장이 먼저 도착했습니다…");
          } else if (event.type === "arm_result" && event.result) {
            if (renderedArms.has(event.arm)) return;
            observedFirstByArm[event.arm] ??= Math.round(performance.now() - requestStartedAt);
            renderRun(event.arm, event.result, observedFirstByArm[event.arm]);
            renderedArms.add(event.arm);
          }
        },
      )
      : await api(`/api/experiments/${state.experimentId}/turns`, request);
    arms.forEach((arm) => {
      if (!renderedArms.has(arm)) {
        observedFirstByArm[arm] ??= Math.round(performance.now() - requestStartedAt);
        renderRun(arm, data.results[arm], observedFirstByArm[arm]);
      }
    });
    renderComparison(data.results, observedFirstByArm);
    state.modeLocked = true;
    const errors = arms.filter((arm) => data.results[arm].status !== "ok");
    setFormStatus(
      errors.length
        ? `${errors.map((arm) => armLabels[arm]).join(", ")} 실행에 실패했습니다. 모드를 바꾸려면 새 실험을 시작하세요.`
        : "비교 결과를 기록했습니다. 이 세션의 비교 모드는 고정됐습니다.",
      Boolean(errors.length),
    );
  } catch (error) {
    arms.forEach((arm) => {
      removeLoading(arm);
      removeStreamingMessage(arm);
      if (!renderedArms.has(arm)) {
        appendMessage(arm, "bot", "요청이 완료되지 않았습니다. 같은 내용을 다시 보내 주세요.");
        ["First", "Total", "ModelMs", "Calls", "Retries"].forEach((suffix) => {
          id(`${arm}${suffix}`).textContent = "—";
        });
      }
      id(`${arm}Rating`).hidden = true;
    });
    id("comparisonSummary").hidden = true;
    setFormStatus(`요청 실패: ${error.message}`, true);
  } finally {
    setBusy(false);
    input.focus();
  }
}

document.querySelectorAll(".segment").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});
document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => {
    id("messageInput").value = button.dataset.example;
    id("messageInput").focus();
  });
});
id("sendButton").addEventListener("click", sendMessage);
id("messageInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});
id("resetButton").addEventListener("click", createExperiment);
id("probeButton").addEventListener("click", async () => {
  id("probeButton").disabled = true;
  await loadHealth(true);
  id("probeButton").disabled = false;
});

setMode("both");
Promise.all([loadHealth(false), createExperiment()]);
