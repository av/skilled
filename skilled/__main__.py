from skilled.app import SkilledApp
from skilled.providers import ClaudeCodeProvider


def main() -> None:
    providers = [ClaudeCodeProvider()]
    app = SkilledApp(providers)
    app.run()


if __name__ == "__main__":
    main()
