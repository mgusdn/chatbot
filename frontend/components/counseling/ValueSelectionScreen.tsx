"use client";

import React, { useState } from "react";
import styles from "./ValueSelectionScreen.module.css";

export type ValueItem = {
  number: number;
  nameKo: string;
  nameEn: string;
  definition: string;
};

const VALUES_DATA: ValueItem[] = [
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

type ValueSelectionScreenProps = {
  onSubmit: (selectedNumbers: number[]) => void;
  busy: boolean;
};

export function ValueSelectionScreen({ onSubmit, busy }: ValueSelectionScreenProps) {
  const [selected, setSelected] = useState<number[]>([]);

  const handleToggle = (num: number) => {
    if (selected.includes(num)) {
      setSelected(selected.filter((n) => n !== num));
    } else {
      if (selected.length >= 5) return;
      setSelected([...selected, num]);
    }
  };

  const handleStart = () => {
    if (selected.length !== 5 || busy) return;
    onSubmit(selected);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <span className={styles.kicker}>CORE VALUES SELECTION</span>
        <h1>나를 설명하는 5가지 가치를 선택해 주세요</h1>
        <p className={styles.subtext}>
          마음 속 깊은 곳, 나를 가장 잘 나타내는 핵심 가치들을 5가지 선택해 보세요.
        </p>
        <div className={styles.counter}>
          선택된 가치: <strong>{selected.length}</strong> / 5
        </div>
      </header>

      <div className={styles.grid}>
        {VALUES_DATA.map((item) => {
          const isSelected = selected.includes(item.number);
          const isMaxed = selected.length >= 5;
          const isDisabled = isMaxed && !isSelected;

          return (
            <button
              key={item.number}
              type="button"
              className={`${styles.card} ${isSelected ? styles.selected : ""} ${
                isDisabled ? styles.disabled : ""
              }`}
              onClick={() => handleToggle(item.number)}
              title={item.definition}
            >
              <div className={styles.cardHeader}>
                <div className={styles.titleGroup}>
                  <span className={styles.num}>{item.number}</span>
                  <strong className={styles.name}>{item.nameKo}</strong>
                  <small className={styles.enName}>{item.nameEn}</small>
                </div>
                {isSelected && <span className={styles.check}>✓</span>}
              </div>
              <p className={styles.definition}>{item.definition}</p>
            </button>
          );
        })}
      </div>

      <footer className={styles.footer}>
        <button
          type="button"
          className={styles.startButton}
          disabled={selected.length !== 5 || busy}
          onClick={handleStart}
        >
          {busy ? "상담실을 열고 있어요..." : "선택 완료하고 상담 시작하기"}
        </button>
      </footer>
    </div>
  );
}
