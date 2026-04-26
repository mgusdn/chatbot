def check_ollama():
    try:
        import urllib.request
        urllib.request.urlopen("http://localhost:11434/", timeout=2)
        print("connected")
    except Exception as e:
        print("not connected")

if __name__ == "__main__":
    check_ollama()
