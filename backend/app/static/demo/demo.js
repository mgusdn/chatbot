const appState = {
  experimentId: null,
  arm: "baseline",
  busy: false,
  done: false,
  turnCount: 0,
  health: null,
  transcript: [],
  filledSlots: new Set(),
  sessionEpoch: 0,
  progressTimers: [],
  mapTimers: [],
  talkTimer: null,
  selectedValues: [],
  latestRunState: null,
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

const CORE_SLOTS = ["situation", "thought", "emotion", "behavior", "coping", "goal"];
const SLOT_LABELS = {
  situation: "상황",
  thought: "생각",
  emotion: "감정",
  cause: "원인",
  behavior: "행동",
  impact: "영향",
  duration: "기간",
  coping: "대처",
  goal: "바람",
};
const SLOT_PLACEHOLDERS = {
  situation: "어떤 일이 있었나요?",
  thought: "무슨 생각이 들었나요?",
  emotion: "어떤 감정이었나요?",
  behavior: "어떻게 반응했나요?",
  coping: "무엇을 해보았나요?",
  goal: "어떻게 달라지고 싶나요?",
};
const ARM_LABELS = {
  optimized: { short: "개선 Gemini · minimal · 판단 API 공유", send: "minimal 흐름으로 말하기" },
  baseline: { short: "A · 공감 minimal · 로컬 원리 · 혼합 판단", send: "A 원리 흐름으로 말하기" },
};

const id = (value) => document.getElementById(value);

function analyzerApiIsSeparate(health) {
  return health?.providers?.gemini?.profiles?.optimized?.analyzer_api_separate === true;
}

function applyHealthProfileCopy(health) {
  const analyzerRoute = analyzerApiIsSeparate(health) ? "분리" : "공유";
  ARM_LABELS.optimized.short = `개선 Gemini · minimal · 판단 API ${analyzerRoute}`;
  id("baselineArmTag").textContent = "A · 공감 + 원리";
  id("baselineArmLabel").textContent = "공감 먼저 · 로컬 원리 · 필요한 판단만 Gemini";
  id("optimizedArmTag").textContent = `B · 판단 API ${analyzerRoute}`;
  id("optimizedArmLabel").textContent = "개선 Gemini · minimal";
  id("activeModelLabel").textContent = ARM_LABELS[appState.arm].short;
  id("sendLabel").textContent = ARM_LABELS[appState.arm].send;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch (_) {
      // Keep the HTTP status when the response is not JSON.
    }
    throw new Error(detail);
  }

  return response.status === 204 ? null : response.json();
}

async function streamApi(path, options = {}, onEvent = () => {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
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

function hasSubstantiveText(value) {
  if (typeof value !== "string") return false;
  const normalized = value.replace(/\s+/g, "").trim();
  return normalized.length >= 2 && /[0-9A-Za-z가-힣]/.test(normalized);
}

function friendlyError(error) {
  const raw = String(error?.message || error || "");
  const lower = raw.toLowerCase();

  if (lower.includes("429") || lower.includes("prepayment") || lower.includes("credits")) {
    return "Gemini 사용 크레딧이 소진되어 지금은 답변할 수 없어요. Google AI Studio 결제를 확인해 주세요.";
  }
  if (
    lower.includes("connection refused") ||
    lower.includes("connecterror") ||
    lower.includes("connection error") ||
    lower.includes("failed to connect") ||
    lower.includes("all connection attempts failed") ||
    lower.includes("서버에 연결할 수 없습니다")
  ) {
    return "Gemini 상담 서비스에 연결하지 못했어요. API 설정과 웹 서버를 확인해 주세요.";
  }
  if (lower.includes("api_key") || lower.includes("provider 설정")) {
    return "선택한 모델의 설정이 아직 준비되지 않았어요. 로컬 환경설정을 확인해 주세요.";
  }
  if (lower.includes("응답 시간이 초과")) {
    return "상담 서버의 응답이 늦어 요청을 마쳤어요. 잠시 뒤 다시 시도해 주세요.";
  }
  if (lower.includes("non_substantive_response")) {
    return "모델이 의미 있는 답변을 만들지 못했어요. 새 상담으로 다시 시작하거나 다른 모델을 선택해 주세요.";
  }
  return "답변을 가져오는 중 문제가 생겼어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
}

function setStageState(nextState) {
  const mood = {
    booting: "상담 준비 중",
    idle: "귀 기울이는 중",
    thinking: "마음을 살피는 중",
    talking: "이야기하는 중",
    error: "연결을 확인해 주세요",
  };
  id("pandaStage").dataset.state = nextState;
  id("pandaMood").textContent = mood[nextState] || mood.idle;
}

function setResponse(text) {
  id("responseText").textContent = text;
  id("responseText").closest(".speech-bubble").scrollTop = 0;
}

function setFormStatus(message, error = false) {
  const target = id("formStatus");
  target.textContent = message || "";
  target.classList.toggle("is-error", error);
}

function clearTimers() {
  appState.progressTimers.forEach(window.clearTimeout);
  appState.mapTimers.forEach(window.clearTimeout);
  appState.progressTimers = [];
  appState.mapTimers = [];
  if (appState.talkTimer) window.clearTimeout(appState.talkTimer);
  appState.talkTimer = null;
}

function scheduleThinkingCopy() {
  clearTimers();
  appState.progressTimers.push(
    window.setTimeout(() => setFormStatus("상황과 감정의 단서를 살피고 있어요."), 1600),
    window.setTimeout(() => setFormStatus("지금 필요한 다음 질문을 고르고 있어요."), 4300),
    window.setTimeout(() => setFormStatus("답변을 차분하게 다듬고 있어요."), 7600),
  );
}

function updateControls() {
  const locked = appState.turnCount > 0;
  id("sendButton").disabled = appState.busy || appState.done || !appState.experimentId;
  id("messageInput").disabled = appState.busy || appState.done || !appState.experimentId;
  id("resetButton").disabled = appState.busy;
  document.querySelectorAll(".model-option").forEach((button) => {
    button.disabled = appState.busy || locked;
    button.title = locked ? "모델을 바꾸려면 새 상담을 시작해 주세요." : "";
  });
  document.querySelectorAll("[data-example]").forEach((button) => {
    button.disabled = appState.busy || appState.done;
  });
}

function providerSummary(arm, provider) {
  if (!provider) {
    return { ready: false, label: "상태 확인 중", detail: "모델 연결 정보를 불러오고 있어요." };
  }
  if (provider.connected === true) {
    return {
      ready: true,
      label: "연결됨",
      detail: `${ARM_LABELS[arm].short} · ${provider.resolved_model || provider.model}`,
    };
  }
  if (provider.connected === null && provider.configured) {
    return {
      ready: true,
      label: "설정됨",
      detail: `${ARM_LABELS[arm].short} 연결은 첫 요청 때 최종 확인돼요.`,
    };
  }
  return {
    ready: false,
    label: provider.configured ? "연결 실패" : "설정 필요",
    detail: "Gemini API 설정과 사용 크레딧을 확인해 주세요.",
  };
}

function renderProviderStatus() {
  const provider = appState.health?.providers?.gemini;
  const summary = providerSummary(appState.arm, provider);
  const chip = id("connectionChip");
  chip.className = provider
    ? `connection-chip ${summary.ready ? "is-ready" : "is-error"}`
    : "connection-chip is-pending";
  chip.innerHTML = `<i></i>${summary.label}`;
  id("connectionDetail").textContent = summary.detail;
}

async function loadHealth(probe = false) {
  try {
    appState.health = await api(`/api/health?probe=${probe}`);
    applyHealthProfileCopy(appState.health);
    renderProviderStatus();
  } catch (_) {
    appState.health = null;
    const chip = id("connectionChip");
    chip.className = "connection-chip is-error";
    chip.innerHTML = "<i></i>웹 서버 연결 실패";
    id("connectionDetail").textContent = "FastAPI 서비스가 실행 중인지 확인해 주세요.";
  }
}

function setSelectedArm(arm) {
  appState.arm = arm;
  document.querySelectorAll(".model-option").forEach((button) => {
    const selected = button.dataset.arm === arm;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-checked", String(selected));
  });
  id("activeModelLabel").textContent = ARM_LABELS[arm].short;
  id("sendLabel").textContent = ARM_LABELS[arm].send;
  renderProviderStatus();
}

function appendTranscript(role, text) {
  appState.transcript.push({ role, text });
  appState.transcript = appState.transcript.slice(-30);
  renderTranscript();
}

function renderTranscript() {
  const list = id("transcriptList");
  list.replaceChildren();

  appState.transcript.forEach((entry) => {
    const item = document.createElement("div");
    item.className = `transcript-item ${entry.role}`;
    const label = document.createElement("strong");
    label.textContent = entry.role === "user" ? "나" : "프바오";
    const copy = document.createElement("span");
    copy.textContent = entry.text;
    item.append(label, copy);
    list.appendChild(item);
  });

  id("transcriptCount").textContent = String(appState.transcript.length);
  list.scrollTop = list.scrollHeight;
}

function latestSubstantiveValue(values) {
  if (!Array.isArray(values)) return "";
  return [...values].reverse().find(hasSubstantiveText) || "";
}

function renderMindMap(runState, animate = false) {
  appState.latestRunState = runState;
  appState.mapTimers.forEach(window.clearTimeout);
  appState.mapTimers = [];

  const filled = new Set(runState?.filled_slots || []);
  const slotValues = runState?.slot_values || {};
  const nextFilled = new Set();

  CORE_SLOTS.forEach((slot, index) => {
    const node = document.querySelector(`[data-slot="${slot}"]`);
    const copy = node.querySelector("p");
    const value = latestSubstantiveValue(slotValues[slot]);
    const isFilled = Boolean(value) || filled.has(slot);
    if (isFilled) nextFilled.add(slot);

    const apply = () => {
      node.classList.toggle("is-filled", isFilled);
      copy.textContent = value || (isFilled ? "관련 단서를 발견했어요." : SLOT_PLACEHOLDERS[slot]);
      if (isFilled && !appState.filledSlots.has(slot)) {
        node.classList.add("is-new");
        window.setTimeout(() => node.classList.remove("is-new"), 700);
      }
    };

    if (animate) {
      appState.mapTimers.push(window.setTimeout(apply, index * 90));
    } else {
      apply();
    }
  });

  appState.filledSlots = nextFilled;
  const count = nextFilled.size;
  id("mindProgress").style.setProperty("--progress", `${count * 60}deg`);
  id("mindProgress").querySelector("strong").textContent = String(count);

  const pending = runState?.pending_slot;
  if (runState?.stage === "done") {
    id("nextClue").textContent = "마음 정리가 완성됐어요";
  } else if (pending && SLOT_LABELS[pending]) {
    id("nextClue").textContent = `다음 단서 · ${SLOT_LABELS[pending]}`;
  } else {
    id("nextClue").textContent = count ? "다음 이야기를 기다리고 있어요" : "첫 이야기를 기다리고 있어요";
  }
  checkValuesStage();
}

function isValuesStageActive() {
  return appState.latestRunState?.stage === "values";
}

function updateSendButtonState() {
  const sendBtn = id("sendButton");
  if (isValuesStageActive()) {
    const ready = appState.selectedValues.length === 5;
    sendBtn.disabled = !ready || appState.busy;
    id("sendLabel").textContent = ready ? "선택 완료하고 상담 시작하기" : `가치 5가지 선택 필요 (${appState.selectedValues.length}/5)`;
  } else {
    sendBtn.disabled = appState.busy || appState.done;
    id("sendLabel").textContent = ARM_LABELS[appState.arm].send;
  }
}

function handleValueToggle(num, cardEl) {
  if (appState.selectedValues.includes(num)) {
    appState.selectedValues = appState.selectedValues.filter((n) => n !== num);
    cardEl.classList.remove("selected");
  } else {
    if (appState.selectedValues.length >= 5) return;
    appState.selectedValues.push(num);
    cardEl.classList.add("selected");
  }

  const isMaxed = appState.selectedValues.length >= 5;
  document.querySelectorAll(".value-btn-card").forEach((card) => {
    const cardNum = parseInt(card.dataset.number, 10);
    const isSelected = appState.selectedValues.includes(cardNum);
    card.classList.toggle("disabled", isMaxed && !isSelected);
  });

  updateSendButtonState();
}

function renderValuesGrid() {
  const container = id("valuesGridContainer");
  if (!container) return;
  if (container.children.length > 0) {
    const isMaxed = appState.selectedValues.length >= 5;
    container.querySelectorAll(".value-btn-card").forEach((card) => {
      const cardNum = parseInt(card.dataset.number, 10);
      const isSelected = appState.selectedValues.includes(cardNum);
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
  const shell = document.querySelector(".composer-card .input-shell");
  const label = document.querySelector(".composer-card .composer-heading h2");
  const kicker = document.querySelector(".composer-card .section-kicker");
  const examples = document.querySelector(".composer-footer .prompt-chips");
  const desc = document.querySelector(".composer-heading p");

  if (!container) return;
  if (active) {
    container.hidden = false;
    if (shell) shell.style.display = "none";
    if (label) label.textContent = "나를 설명하는 5가지 가치를 아래에서 선택해 주세요 (5개 선택 시 전송 가능)";
    if (examples) examples.style.display = "none";
    if (kicker) kicker.textContent = "CORE VALUES SELECTION";
    if (desc) desc.style.display = "none";
    renderValuesGrid();
    updateSendButtonState();
  } else {
    container.hidden = true;
    if (shell) shell.style.display = "flex";
    if (label) label.textContent = "지금 마음에 걸리는 일을 말해 주세요";
    if (examples) examples.style.display = "flex";
    if (kicker) kicker.textContent = "TELL ME YOUR STORY";
    if (desc) desc.style.display = "block";
    id("sendButton").disabled = appState.busy || appState.done;
    id("sendLabel").textContent = ARM_LABELS[appState.arm].send;
  }
}

async function fetchDemoState() {
  return api(`/api/experiments/${appState.experimentId}/demo-state?arm=${appState.arm}`);
}

async function newSession() {
  const epoch = ++appState.sessionEpoch;
  clearTimers();
  appState.busy = true;
  appState.done = false;
  appState.experimentId = null;
  appState.turnCount = 0;
  appState.transcript = [];
  appState.filledSlots = new Set();
  updateControls();
  setStageState("booting");
  setResponse("잠시만요. 편안하게 이야기할 자리를 준비하고 있어요.");
  setFormStatus("새 상담 세션을 만드는 중이에요.");
  id("latencyLabel").textContent = "응답 시간 —";
  id("turnLabel").textContent = "0번째 이야기";
  renderMindMap({ filled_slots: [], slot_values: {}, stage: "rapport" });

  try {
    const data = await api("/api/experiments", { method: "POST", body: "{}" });
    if (epoch !== appState.sessionEpoch) return;
    appState.experimentId = data.experiment_id;
    const greeting = data.greetings[appState.arm] || "안녕하세요. 오늘 어떤 마음으로 오셨나요?";
    setResponse(greeting);
    appendTranscript("bot", greeting);
    renderMindMap(data.states[appState.arm]);
    setStageState("idle");
    setFormStatus("준비됐어요. 지금 마음에 걸리는 일을 편하게 들려주세요.");
  } catch (error) {
    if (epoch !== appState.sessionEpoch) return;
    setStageState("error");
    const message = friendlyError(error);
    setResponse(message);
    setFormStatus(message, true);
  } finally {
    if (epoch === appState.sessionEpoch) {
      appState.busy = false;
      updateControls();
      if (appState.experimentId) id("messageInput").focus();
    }
  }
}

async function sendMessage() {
  if (appState.busy || appState.done || !appState.experimentId) return;
  const input = id("messageInput");
  let message = "";

  if (isValuesStageActive()) {
    if (appState.selectedValues.length !== 5) {
      setFormStatus("가치 5가지를 선택해야 다음 단계로 갈 수 있습니다.", true);
      return;
    }
    message = appState.selectedValues.join(", ");
  } else {
    message = input.value.trim();
    if (!message) {
      setFormStatus("프바오에게 들려줄 이야기를 입력해 주세요.", true);
      input.focus();
      return;
    }
  }

  appendTranscript("user", message);
  input.value = "";
  if (isValuesStageActive()) {
    appState.selectedValues = [];
  }
  appState.busy = true;
  updateControls();
  setStageState("thinking");
  setResponse("이야기를 차분히 듣고 있어요");
  id("latencyLabel").textContent = "응답 시간 측정 중…";
  setFormStatus(`${ARM_LABELS[appState.arm].short}이 마음의 흐름을 살피고 있어요.`);
  scheduleThinkingCopy();

  try {
    const requestStartedAt = performance.now();
    let streamedText = "";
    let firstResponseMs = null;
    let lastStreamSequence = 0;
    const request = {
      method: "POST",
      body: JSON.stringify({ message, arms: [appState.arm] }),
    };
    const data = appState.arm === "baseline"
      ? await streamApi(
        `/api/experiments/${appState.experimentId}/turns/stream`,
        request,
        (event) => {
          if (
            event.type !== "segment"
            || event.arm !== "baseline"
            || event.sequence <= lastStreamSequence
          ) return;
          lastStreamSequence = event.sequence;
          if (firstResponseMs === null) {
            firstResponseMs = Math.round(performance.now() - requestStartedAt);
            id("latencyLabel").textContent = `브라우저 첫 표시 ${firstResponseMs} ms · 서버 전체 계산 중…`;
          }
          streamedText = event.segment === "bridge" || event.segment === "aside"
            ? `${streamedText} ${event.text}`.trim()
            : event.text;
          clearTimers();
          setResponse(streamedText);
          setStageState("talking");
          setFormStatus(event.segment === "bridge"
            ? "프바오가 천천히 이야기를 이어가고 있어요."
            : event.segment === "aside"
              ? "프바오가 생각을 정리하며 말을 잇고 있어요."
              : "프바오가 먼저 마음을 헤아려 말하고 있어요.");
        },
      )
      : await api(`/api/experiments/${appState.experimentId}/turns`, request);
    const result = data.results[appState.arm];
    if (!result || result.status !== "ok") {
      throw new Error(result?.error || "모델 응답이 없습니다.");
    }
    if (!hasSubstantiveText(result.message)) {
      appState.turnCount = result.state?.turn_count || appState.turnCount;
      appState.done = true;
      id("turnLabel").textContent = `${appState.turnCount}번째 이야기`;
      id("latencyLabel").textContent = `응답 시간 ${Math.round(result.metrics.total_ms)} ms`;
      throw new Error("NON_SUBSTANTIVE_RESPONSE");
    }

    clearTimers();
    appState.turnCount = result.state.turn_count;
    appState.done = result.state.stage === "done";
    id("turnLabel").textContent = `${appState.turnCount}번째 이야기`;
    const firstMs = firstResponseMs ?? Math.round(performance.now() - requestStartedAt);
    id("latencyLabel").textContent = `브라우저 첫 표시 ${Math.round(firstMs)} ms · 서버 전체 ${Math.round(result.metrics.total_ms)} ms`;
    setResponse(result.message);
    appendTranscript("bot", result.message);
    setStageState("talking");

    try {
      const detailedState = await fetchDemoState();
      renderMindMap(detailedState, true);
    } catch (_) {
      renderMindMap(result.state, true);
    }

    if (result.safety_bypass) {
      setFormStatus("지금은 안전을 가장 먼저 생각해야 해요. 화면의 안내에 따라 즉시 도움을 요청해 주세요.");
    } else if (appState.done) {
      setFormStatus("마음 정리가 완성됐어요. 다시 이야기하려면 ‘새 상담’을 눌러주세요.");
    } else {
      setFormStatus("답변이 도착했어요. 이어서 천천히 이야기해 주세요.");
    }

    appState.talkTimer = window.setTimeout(() => setStageState("idle"), 1500);
  } catch (error) {
    clearTimers();
    id("latencyLabel").textContent = "응답 시간 —";
    const messageForUser = friendlyError(error);
    setStageState("error");
    setResponse(messageForUser);
    setFormStatus(messageForUser, true);
  } finally {
    appState.busy = false;
    updateControls();
    if (!appState.done) input.focus();
  }
}

document.querySelectorAll(".model-option").forEach((button) => {
  button.addEventListener("click", async () => {
    if (appState.busy || appState.turnCount > 0 || button.dataset.arm === appState.arm) return;
    setSelectedArm(button.dataset.arm);
    await newSession();
  });
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
id("resetButton").addEventListener("click", newSession);

setSelectedArm("baseline");
updateControls();
Promise.all([loadHealth(true), newSession()]);
