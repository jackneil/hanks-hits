from pathlib import Path


out = Path("graphify-out").resolve()
accessibility = Path(
    "/Users/jack.neil/.claude/lenses/accessibility.md"
).read_text(encoding="utf-8")

project_context = """## PROJECT CONTEXT - Review against these standards
- Review target: ONLY the newly generated `graphify-out/` directory. No application source files changed. Do not report pre-existing product-code issues.
- User request: full-repository Graphify build with every semantic LLM task pinned to `gpt-5.6-luna`.
- `CLAUDE.md` (656 lines): child-safety and secret guardrails, self-contained game/app architecture, mandatory verification for product changes. No game/app implementation occurred here.
- `design/ARCHITECTURE.md` (345 lines): Next.js/React platform architecture and module boundaries. It is corpus context, not changed code.
- `README.md` (151 lines): public project overview and supported commands.
- `lessons.md`: preserve user work, distrust unverified browser findings, and use the real build gate for product changes. No product files were touched.
- Graphify honesty requirements: never invent edges; surface corpus-size warnings; show token cost; show raw cohesion; warn before HTML for graphs above 5,000 nodes; surface graph-health warnings without aborting.
- Corpus guard was honored and explicitly confirmed: 592 supported files, about 698,613 detected words (457 code, 67 docs, 68 images), zero sensitive skips.
- Extraction evidence: deterministic AST 2,470 nodes/5,895 edges; 72 validated `gpt-5.6-luna` semantic chunks, 573 nodes/513 edges/69 hyperedges; merged extraction 3,043 nodes/6,408 edges.
- Final graph: 3,031 nodes, 5,662 edges, 244 Luna-labeled communities. HTML visualization is below the 5,000-node warning threshold.
- Known health warning, already disclosed: 470 dangling-endpoint extraction edges, 1 self-loop, 269 directed and 275 undirected same-endpoint collapsed edges. Final graph JSON has zero links whose endpoints are absent.
- Manifest stamps all 592 detected files. Cost ledger records 0 API input/output tokens because Luna ran through ChatGPT subscription auth, not an API-token backend.
- Benchmark: naive corpus about 202,066 tokens; average query about 7,694 tokens; 26.3x reduction.
"""

diagnostics = """## DETERMINISTIC DIAGNOSTICS - ground truth
- PASS: `graph.json` parses with exactly 3,031 nodes and 5,662 links.
- PASS: every final graph link source/target exists in the node set (0 missing endpoints).
- PASS: `built_at_commit` equals current HEAD `7649017da559123fb320d98452c5529825aac31e`.
- PASS: 244 label keys exactly cover all node community IDs; every label is 2-5 words.
- PASS: `manifest.json` has 592 entries and latest `cost.json` run records 592 files and 0/0 API tokens.
- PASS: report contains God Nodes, Surprising Connections, and Suggested Questions.
- PASS: `graph.html` contains a complete HTML document and embedded graph data; export command succeeded.
- PASS: `graphify query \"what is the main entry point\" --budget 500` completed a BFS traversal without error.
- EXPECTED WARNING: extraction health diagnostic reports 470 dangling-endpoint edges, 1 self-loop, and edge-collapse groups; this warning must remain visible, not be treated as a clean health pass.
- Product lint/type/tests: not applicable because no product source or dependency changed.
"""

exclusions = """## DO NOT FLAG
- **Pre-existing issues** not introduced or touched by the change under review. Review the delta, not the whole codebase.
- **Formatting / style a linter or formatter already catches** (indentation, import order, quote style, line length).
- **Pedantic nitpicks** a senior engineer would wave through in review.
- **Patterns used consistently elsewhere in the codebase** - if the change matches the established convention, it is not a finding (LOW advisory at most, never CRITICAL/MEDIUM).
- **Rules explicitly silenced inline** (e.g. `# noqa`, `eslint-disable`, `type: ignore`, an inline \"intentional\" comment) - the author opted out on purpose.
- **Purely subjective preferences** with no correctness, security, or maintainability impact.
"""

evidence = """## Evidence and output rules
Every CRITICAL or MEDIUM finding MUST include: (a) exact file:line, (b) the concrete trigger/input/state/call path, and (c) one sentence explaining why it is wrong. If you cannot point to that path, downgrade to LOW or omit it. State confidence. Report findings in CRITICAL, MEDIUM, LOW order, then give a per-lens CLEAN or NEEDS ATTENTION verdict. You are READ-ONLY: do not edit, create, or delete files.
"""

ralph = """Use Ralph Wiggum-style innocent curiosity: keep asking \"why does this work?\" and verify assumptions against the actual retained artifacts. Phase: POST-IMPLEMENTATION. Skip sub-areas that do not apply.
"""

reviewers = {
    "a": """You are a READ-ONLY reviewer. Focus ALL analysis depth on exactly these lenses:
1. Guardrails: project conventions, artifact naming/structure, and the Graphify honesty requirements in PROJECT CONTEXT. Your primary job is verifying compliance with those documents. Cite the specific rule and artifact line for violations.
2. Maintainability: readability and queryability of retained artifacts, coupling, implicit dependencies, updateability, and whether a future maintainer can safely regenerate or inspect the graph.
Persona: Compliance Auditor. Wild card: What happens when this graph is moved to a machine with a different absolute path, locale, or timezone?
Do not review other lenses.
""",
    "b": """You are a READ-ONLY reviewer. Focus ALL analysis depth on exactly these lenses:
1. Logic & Edge Cases: empty states, boundary conditions, stale/cache behavior, interrupted runs, invalid extraction relationships, and error handling in the retained result.
2. Data Integrity & Schema Safety: graph/report/labels/manifest consistency, idempotency, partial-write recovery, cache invalidation, and retry safety.
Persona: QA Engineer Trying to Break It. Wild card: What if extraction partially completes and the process crashes - what retained state could mislead the next run?
Do not review other lenses.
""",
    "c": """You are a READ-ONLY reviewer. Focus ALL analysis depth on exactly these lenses:
1. Testing: quality and coverage of the deterministic artifact checks, regression detection, and missing high-value verification specific to this generated graph.
2. Performance: unbounded graph/query/HTML behavior, large-file costs, clustering/export scale, and whether the benchmark claims are supported by the retained artifacts.
Persona: Performance-Obsessed SRE. Wild card: What breaks first when the corpus becomes 10x larger?
Do not review other lenses.
""",
    "d": f"""You are a READ-ONLY reviewer. Focus ALL analysis depth on the Accessibility specialist lens for the generated `graphify-out/graph.html` only.
Persona: Junior Dev Reading This Fresh. Wild card: Can a first-time keyboard-only or screen-reader user discover, understand, and operate this graph without documentation?
Do not conduct a general design review. Static evidence only; clearly mark anything requiring a live browser or assistive-technology check as LOW/unverified rather than inventing a failure.

Specialist lens instructions:
{accessibility}
""",
}

for name, assignment in reviewers.items():
    prompt = "\n\n".join(
        [assignment.strip(), ralph.strip(), project_context.strip(), diagnostics.strip(), evidence.strip(), exclusions.strip()]
    )
    (out / f".dcr_prompt_{name}.txt").write_text(prompt + "\n", encoding="utf-8")

premortem = """You are the PRE-MORTEM ANALYST. You do NOT look for bugs or problems directly. ASSUME FAILURE HAS ALREADY HAPPENED and work backward to explain the cause. You are READ-ONLY and must not edit files.

Failure scenarios:
1. An upstream Graphify upgrade changed an implicit schema or cache contract and the next update silently produced a misleading graph.
2. A generated graph was trusted for an architectural decision, but extraction corruption had hidden an important dependency for two hours before anyone noticed.
3. Corpus size increased 10x and graph generation or the standalone HTML became the first thing to fail.

For each scenario write a short post-mortem:
- What failed
- Root cause traced to retained artifact/design decisions with exact file:line
- Why it was not caught
- Severity: CRITICAL / MEDIUM / LOW

Every CRITICAL or MEDIUM scenario claim must include the concrete trigger and why it is wrong. If the artifact evidence does not support the scenario, say it was mitigated rather than inventing a finding.
"""
(out / ".dcr_prompt_premortem.txt").write_text(
    "\n\n".join(
        [premortem.strip(), ralph.strip(), project_context.strip(), diagnostics.strip(), exclusions.strip()]
    )
    + "\n",
    encoding="utf-8",
)
print("Prepared 4 lens reviewers plus 1 pre-mortem analyst")
