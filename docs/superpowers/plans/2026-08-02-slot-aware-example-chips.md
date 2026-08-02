# 슬롯별 예시 칩 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상담 화면 입력창 하단의 예시 칩 문구가, 프바오가 지금 묻고 있는 슬롯(situation/emotion/thought/...)에 맞춰 바뀌도록 한다. 칩 라벨(미루는 습관/관계 걱정/잠들기 어려움)과 개수(3개)는 모든 슬롯에서 그대로 두고, 클릭 시 입력창에 채워지는 예시 문장만 슬롯별로 교체한다.

**Architecture:** `frontend/components/counseling/CounselingScreen.tsx`의 정적 `EXAMPLES` 배열을 슬롯 키로 색인되는 `SLOT_EXAMPLES` 맵으로 바꾸고, 렌더링 시 `session.runState.pending_slot` 값으로 현재 슬롯의 예시 배열을 조회한다. 순수 프론트엔드 정적 데이터 변경이며, 백엔드/타입 정의 변경은 없다.

**Tech Stack:** Next.js (React, TypeScript), 기존 `useCounselingSession` 훅의 `runState.pending_slot` 값 사용.

## Global Constraints

- 칩 라벨은 모든 슬롯에서 정확히 "미루는 습관", "관계 걱정", "잠들기 어려움" 3개로 고정한다 (스펙 "목표" 절).
- `pending_slot`이 없거나(rapport/values/done 단계) 알 수 없는 키일 경우 `situation` 슬롯의 예시(기존 문구와 동일)를 기본값으로 사용한다 (스펙 "데이터 소스" 절).
- 예시 문구 33개(11슬롯 × 3라벨)는 스펙 문서의 표 내용을 한 글자도 바꾸지 않고 그대로 옮긴다 (스펙 "전체 슬롯별 문구" 절, 사용자가 이미 승인한 확정 텍스트).
- 자동화 테스트는 추가하지 않는다 — 순수 정적 텍스트 매핑이라 수동 확인으로 검증한다 (스펙 "범위 밖" 절).
- 백엔드 변경 없음.

---

## Task 1: EXAMPLES를 슬롯별 SLOT_EXAMPLES 맵으로 교체

**Files:**
- Modify: `frontend/components/counseling/CounselingScreen.tsx:12-16` (상수 정의)
- Modify: `frontend/components/counseling/CounselingScreen.tsx:235-239` (렌더링부, `prompt-chips` 블록)

**Interfaces:**
- Consumes: `session.runState.pending_slot` — 기존 `useCounselingSession` 훅이 이미 제공하는 값 (`frontend/types/counseling.ts`의 `PublicCounselState.pending_slot: string | null | undefined`). 새로 추가하는 코드가 아님, 기존 값을 읽기만 함.
- Produces: 이 태스크로 끝나는 단일 컴포넌트 변경이라 다른 태스크가 소비할 새 export는 없음.

- [ ] **Step 1: 현재 파일 상태 확인**

`frontend/components/counseling/CounselingScreen.tsx`의 12~16행(EXAMPLES 정의)과 235~239행(`prompt-chips` 렌더링) 주변을 읽어서, 아래 diff를 적용할 정확한 줄 번호가 맞는지 확인한다. (이전 세션에서 이미 이 파일을 읽었으므로 줄 번호가 다르면 최신 내용 기준으로 위치를 다시 찾는다.)

- [ ] **Step 2: `EXAMPLES` 상수를 `SLOT_EXAMPLES` 맵으로 교체**

12~16행의 기존 코드:

```tsx
const EXAMPLES = [
  ["미루는 습관", "요즘 해야 할 일이 많은데 자꾸 미루게 돼서 스스로에게 답답해요."],
  ["관계 걱정", "사람들을 만나고 나면 제가 이상하게 말한 것 같아서 계속 걱정돼요."],
  ["잠들기 어려움", "밤에 생각이 많아져서 잠들기가 어렵고 다음 날 너무 피곤해요."],
] as const;
```

이걸 아래로 완전히 교체한다:

```tsx
const SLOT_EXAMPLES: Record<string, readonly (readonly [string, string])[]> = {
  situation: [
    ["미루는 습관", "요즘 해야 할 일이 많은데 자꾸 미루게 돼서 스스로에게 답답해요."],
    ["관계 걱정", "사람들을 만나고 나면 제가 이상하게 말한 것 같아서 계속 걱정돼요."],
    ["잠들기 어려움", "밤에 생각이 많아져서 잠들기가 어렵고 다음 날 너무 피곤해요."],
  ],
  emotion: [
    ["미루는 습관", "일을 또 미뤘다는 생각에 답답하고 저 자신한테 실망스러워요."],
    ["관계 걱정", "그 자리를 떠올리면 창피하고 불안한 마음이 들어요."],
    ["잠들기 어려움", "잠을 설치고 나면 무기력하고 예민해져요."],
  ],
  thought: [
    ["미루는 습관", "나는 왜 항상 이렇게 미루기만 할까 하는 생각이 들어요."],
    ["관계 걱정", "다들 나를 이상하게 봤을 것 같다는 생각이 계속 들어요."],
    ["잠들기 어려움", "내일도 못 잘까봐 걱정하는 생각이 머릿속을 떠나지 않아요."],
  ],
  cause: [
    ["미루는 습관", "완벽하게 하지 못할 바엔 시작을 미루는 게 편해서 그런 것 같아요."],
    ["관계 걱정", "예전에 말실수했던 기억이 자꾸 떠올라서 그런 것 같아요."],
    ["잠들기 어려움", "낮 동안 정리 못 한 걱정거리들이 밤에 한꺼번에 떠올라서 그런 것 같아요."],
  ],
  behavior: [
    ["미루는 습관", "마감이 코앞에 닥쳐야 겨우 시작하고, 그전까진 계속 딴짓을 해요."],
    ["관계 걱정", "사람 만나는 자리를 이런저런 핑계로 피하게 돼요."],
    ["잠들기 어려움", "잠들려고 누워서도 계속 휴대폰을 들여다보게 돼요."],
  ],
  duration: [
    ["미루는 습관", "한 학기 내내 그랬고, 마감 있는 일마다 매번 반복돼요."],
    ["관계 걱정", "두어 달 전부터 사람 만난 다음 날마다 그래요."],
    ["잠들기 어려움", "3주 정도 됐고, 거의 매일 밤 그래요."],
  ],
  impact: [
    ["미루는 습관", "마감 직전에 몰아서 하다 보니 결과물 퀄리티도 떨어지고 스트레스도 심해져요."],
    ["관계 걱정", "만남 자체가 부담스러워져서 약속을 점점 줄이게 돼요."],
    ["잠들기 어려움", "다음 날 계속 피곤해서 일에 집중이 잘 안 돼요."],
  ],
  relationship: [
    ["미루는 습관", "팀원들한테 계속 민폐를 끼치는 것 같아서 눈치가 보여요."],
    ["관계 걱정", "친했던 친구들과도 점점 연락이 뜸해졌어요."],
    ["잠들기 어려움", "예민해져서 가족들한테 괜히 짜증을 내게 돼요."],
  ],
  coping: [
    ["미루는 습관", "할 일 목록을 만들어봤는데 그때뿐이고 오래가지 않아요."],
    ["관계 걱정", "만나기 전에 할 말을 미리 연습해봤는데 크게 도움은 안 됐어요."],
    ["잠들기 어려움", "자기 전에 휴대폰을 안 보려고 해봤는데 잘 지켜지지 않아요."],
  ],
  goal: [
    ["미루는 습관", "미리미리 시작해서 여유 있게 마무리하고 싶어요."],
    ["관계 걱정", "만남 후에 곱씹지 않고 편하게 넘길 수 있으면 좋겠어요."],
    ["잠들기 어려움", "누우면 금방 잠들 수 있으면 좋겠어요."],
  ],
  self_message: [
    ["미루는 습관", "완벽하지 않아도 괜찮으니 일단 시작해보자고 말해주고 싶어요."],
    ["관계 걱정", "그 정도 실수는 아무도 신경 안 쓴다고 말해주고 싶어요."],
    ["잠들기 어려움", "오늘 하루도 충분히 애썼다고, 이제 마음 편히 쉬어도 된다고 말해주고 싶어요."],
  ],
} as const;

const DEFAULT_EXAMPLES = SLOT_EXAMPLES.situation;
```

- [ ] **Step 3: 컴포넌트 함수 안에 현재 슬롯의 예시를 조회하는 변수 추가**

`CounselingScreen` 함수 본문에서 `session`을 가져온 직후 (기존 25번째 줄, `const session = useCounselingSession(...)` 바로 아래) 다음 줄을 추가한다:

```tsx
const currentExamples = SLOT_EXAMPLES[session.runState.pending_slot ?? ""] ?? DEFAULT_EXAMPLES;
```

- [ ] **Step 4: 렌더링부에서 `EXAMPLES` 대신 `currentExamples` 사용**

기존 (`prompt-chips` 블록, 235~239행 부근):

```tsx
<div className="prompt-chips" aria-label="상담 예시">
  {EXAMPLES.map(([label, example]) => (
    <button key={label} type="button" disabled={session.busy || session.done} onClick={() => { setMessage(example); inputRef.current?.focus(); }}>{label}</button>
  ))}
</div>
```

변경 후:

```tsx
<div className="prompt-chips" aria-label="상담 예시">
  {currentExamples.map(([label, example]) => (
    <button key={label} type="button" disabled={session.busy || session.done} onClick={() => { setMessage(example); inputRef.current?.focus(); }}>{label}</button>
  ))}
</div>
```

- [ ] **Step 5: 타입 체크**

Run: `cd "frontend" && npm run lint`

Expected: `tsc --noEmit`이 에러 없이 통과한다 (이 프로젝트의 `lint` 스크립트는 `tsc --noEmit`이다). `SLOT_EXAMPLES` 조회 결과 타입이 `readonly (readonly [string, string])[]`로 일관되고, `pending_slot`이 `string | null | undefined`이므로 `?? ""`로 `string`으로 좁혀지는지 확인한다.

- [ ] **Step 6: 프런트 개발 서버에서 수동 확인**

`frontend`에서 `npm run dev`가 이미 떠 있지 않다면 실행한다. 브라우저에서 상담 화면에 진입해 슬롯이 바뀔 때마다(situation → emotion → thought → ...) 예시 칩 3개의 라벨이 항상 "미루는 습관/관계 걱정/잠들기 어려움"으로 고정이고, 클릭 시 입력창에 채워지는 문장이 스펙 문서의 표(`docs/superpowers/specs/2026-08-02-slot-aware-example-chips-design.md`)와 일치하는지 확인한다. 대화 시작 전(rapport 단계)에는 situation 행과 동일한 문구(기존 동작)가 뜨는지 확인한다.

- [ ] **Step 7: 커밋**

```bash
git add frontend/components/counseling/CounselingScreen.tsx
git commit -m "$(cat <<'EOF'
feat: show slot-specific example chips in counseling composer

Example chips now change wording per the slot Pbao is currently
asking about (situation/emotion/thought/...), while keeping the same
three labels and story threads across every slot so users can follow
one narrative through the whole conversation.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
