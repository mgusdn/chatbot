"""
Mock 회사 데이터 — GraphRAG 대체

프로토타입에서는 실제 GraphRAG 인덱스 대신
하드코딩된 회사 정보를 사용한다.
"""

MOCK_COMPANIES = {
    "ai_platform": {
        "name": "AI 플랫폼 기업",
        "industry": "AI/ML",
        "values": "운영 안정성, 협업, 데이터 기반 의사결정, 지속적 학습",
        "culture": "실험과 안정성의 균형을 중시. 빠른 프로토타이핑과 점진적 개선을 선호.",
        "tech_stack": ["Python", "Kubernetes", "MLflow", "Airflow", "FastAPI", "PostgreSQL"],
        "jd_highlights": [
            "ML 파이프라인 설계 및 운영 경험",
            "모델 서빙 인프라 구축 (Kubernetes, Docker)",
            "CI/CD 자동화 파이프라인 구현",
            "데이터 품질 모니터링 체계 구축",
            "장애 대응 및 운영 안정성 확보",
        ],
        "interview_style": "실무 중심, 구체적 경험과 수치를 중시, 협업 경험 확인",
        "ideal_candidate": "기술적 깊이와 운영 감각을 모두 갖춘 엔지니어. 장애 상황에서 침착하게 대응하고, 팀과 소통하며 문제를 해결할 수 있는 사람.",
        "roles": {
            "mlops_engineer": {
                "title": "MLOps 엔지니어",
                "competencies": [
                    "ML 파이프라인 설계",
                    "배포 자동화",
                    "모니터링 및 장애 대응",
                    "팀 협업",
                    "문제 해결 능력",
                ],
                "questions_by_competency": {
                    "ML 파이프라인 설계": [
                        "가장 최근에 설계하신 ML 파이프라인의 전체 구조를 설명해 주세요.",
                        "데이터 수집부터 모델 서빙까지 어떤 도구를 사용하셨나요?",
                        "파이프라인에서 병목이 발생했던 경험이 있다면 어떻게 해결하셨나요?",
                    ],
                    "배포 자동화": [
                        "CI/CD 파이프라인을 직접 구축하신 경험을 설명해 주세요.",
                        "배포 과정에서 롤백이 필요했던 상황은 어떻게 처리하셨나요?",
                        "컨테이너 기반 배포 환경에서 겪은 어려움은 무엇이었나요?",
                    ],
                    "모니터링 및 장애 대응": [
                        "운영 중 모델 성능이 저하된 것을 어떻게 감지하셨나요?",
                        "프로덕션 장애가 발생했을 때 대응 프로세스를 설명해 주세요.",
                        "모니터링 대시보드를 구축하신 경험이 있다면 말씀해 주세요.",
                    ],
                    "팀 협업": [
                        "다른 팀과 협업하면서 기술적 의견이 충돌했던 경험이 있나요?",
                        "비개발 직군과 소통할 때 어떤 방식을 사용하셨나요?",
                    ],
                    "문제 해결 능력": [
                        "예상치 못한 기술적 문제를 해결했던 경험을 말씀해 주세요.",
                        "제한된 시간 안에 의사결정을 내려야 했던 상황은 어떻게 처리하셨나요?",
                    ],
                },
            }
        },
    },
    "fintech": {
        "name": "핀테크 스타트업",
        "industry": "금융/핀테크",
        "values": "보안 최우선, 빠른 실행, 규제 준수, 사용자 중심",
        "culture": "스타트업 문화지만 금융 규제에 대한 깊은 이해를 요구. 빠른 의사결정과 책임감을 강조.",
        "tech_stack": ["Java", "Spring Boot", "AWS", "Kafka", "Redis", "MySQL"],
        "jd_highlights": [
            "결제 시스템 설계 및 운영",
            "대용량 트랜잭션 처리 경험",
            "보안 및 규제 준수 (PCI-DSS 등)",
            "마이크로서비스 아키텍처 설계",
        ],
        "interview_style": "보안과 안정성에 대한 깊은 이해를 확인, 실제 장애 사례 중심",
        "ideal_candidate": "보안과 안정성을 최우선으로 고려하면서도 빠르게 실행할 수 있는 백엔드 엔지니어.",
        "roles": {
            "backend_engineer": {
                "title": "백엔드 엔지니어",
                "competencies": [
                    "결제 시스템 설계",
                    "대용량 트래픽 처리",
                    "보안 및 규제",
                    "마이크로서비스",
                    "장애 대응",
                ],
                "questions_by_competency": {
                    "결제 시스템 설계": [
                        "결제 시스템에서 원자성을 보장하기 위해 어떤 전략을 사용하셨나요?",
                    ],
                    "대용량 트래픽 처리": [
                        "초당 수천 건의 트랜잭션을 처리해야 하는 상황에서 어떤 아키텍처를 설계하셨나요?",
                    ],
                    "보안 및 규제": [
                        "결제 데이터 보안을 위해 어떤 암호화 전략을 적용하셨나요?",
                    ],
                    "마이크로서비스": [
                        "서비스 간 통신에서 발생할 수 있는 장애를 어떻게 격리하셨나요?",
                    ],
                    "장애 대응": [
                        "결제 장애가 발생했을 때 고객 영향을 최소화하기 위해 어떤 조치를 취하셨나요?",
                    ],
                },
            }
        },
    },
}


def get_company(company_id: str = "ai_platform") -> dict:
    """회사 정보를 반환한다."""
    return MOCK_COMPANIES.get(company_id, MOCK_COMPANIES["ai_platform"])


def get_evidence_for_query(company_id: str, query: str, mode: str = "local") -> str:
    """
    Mock retrieval — 쿼리에 기반한 회사 근거를 반환한다.
    실제 GraphRAG 대신 하드코딩된 정보에서 관련 내용을 추출한다.
    """
    company = get_company(company_id)

    if mode == "global":
        # 회사 전체 문화/가치관 관련
        return (
            f"회사: {company['name']}\n"
            f"핵심 가치: {company['values']}\n"
            f"조직 문화: {company['culture']}\n"
            f"인재상: {company['ideal_candidate']}"
        )
    elif mode == "local":
        # JD/기술 관련
        jd = "\n".join(f"- {item}" for item in company["jd_highlights"])
        tech = ", ".join(company["tech_stack"])
        return (
            f"회사: {company['name']}\n"
            f"기술 스택: {tech}\n"
            f"직무 요구사항:\n{jd}\n"
            f"면접 스타일: {company['interview_style']}"
        )
    else:
        # drift — 특정 주제와 회사 맥락 연결
        return (
            f"회사: {company['name']}\n"
            f"산업: {company['industry']}\n"
            f"가치: {company['values']}\n"
            f"면접 스타일: {company['interview_style']}\n"
            f"인재상: {company['ideal_candidate']}"
        )
