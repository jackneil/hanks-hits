import concurrent.futures
import subprocess
from pathlib import Path


OUT = Path("graphify-out").resolve()
MODEL = "gpt-5.6-luna"
EFFORT = "medium"
NAMES = ["a", "b", "c", "d", "premortem"]


def run(name: str) -> tuple[str, int, int]:
    prompt = (OUT / f".dcr_prompt_{name}.txt").read_text(encoding="utf-8")
    command = [
        "codex",
        "exec",
        "-m",
        MODEL,
        "-c",
        f'model_reasoning_effort="{EFFORT}"',
        "--sandbox",
        "read-only",
        "--ephemeral",
        "--skip-git-repo-check",
        "-",
    ]
    completed = subprocess.run(
        command,
        input=prompt,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    report = completed.stdout or ""
    (OUT / f".dcr_review_{name}.txt").write_text(report, encoding="utf-8")
    (OUT / f".dcr_trace_{name}.log").write_text(
        completed.stderr or "", encoding="utf-8"
    )
    return name, completed.returncode, len(report)


with concurrent.futures.ThreadPoolExecutor(max_workers=len(NAMES)) as pool:
    futures = [pool.submit(run, name) for name in NAMES]
    failures = []
    for future in concurrent.futures.as_completed(futures):
        name, returncode, chars = future.result()
        valid = returncode == 0 and chars >= 100
        print(
            f"DCR reviewer {name}: exit={returncode}, report_chars={chars}, "
            f"{'valid' if valid else 'INVALID'}",
            flush=True,
        )
        if not valid:
            failures.append(name)
if failures:
    raise SystemExit(f"ERROR: invalid DCR reports: {failures}")
print("All five gpt-5.6-luna DCR reports captured", flush=True)
