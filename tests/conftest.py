import os


os.environ["CHATBOT_MOCK_MODE"] = "true"
os.environ["MOCK_GEMINI_DELAY_MS"] = "0"
os.environ["PRINCIPLE_DB_PATH"] = (
    f"/private/tmp/pume-chatbot-test-principles-{os.getpid()}.sqlite3"
)
