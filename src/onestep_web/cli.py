from __future__ import annotations

import argparse

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(prog="onestep-web")
    subparsers = parser.add_subparsers(dest="command")
    serve = subparsers.add_parser("serve")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", default=8000, type=int)
    serve.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    if args.command in {None, "serve"}:
        uvicorn.run(
            "onestep_web.main:app",
            host=args.host,
            port=args.port,
            reload=args.reload,
        )
        return
    parser.error(f"unknown command {args.command}")


if __name__ == "__main__":
    main()
