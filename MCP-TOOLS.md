# MCP Tools Setup

This project uses three MCP servers to enhance Claude Code sessions.

## Claudette (Code Knowledge Graph)

Persistent incremental knowledge graph that helps Claude understand code structure, find callers,
and analyze the impact radius of changes.

### Installation

Claudette is a Go binary that requires CGO (for Tree-sitter parsing and SQLite):

```bash
git clone https://github.com/nicmarti/Claudette.git
cd Claudette
make build
make install   # Installs to $GOPATH/bin
```

> Requires Go 1.22+ and a C compiler (Xcode CLI tools on macOS).

### Building the Graph

First-time setup — build the full knowledge graph:

```bash
claudette build
```

This creates a `.claudette/` directory with a SQLite database containing the code graph.

### Keeping the Graph Up to Date

**Manual update** (incremental, only changed files since last commit):

```bash
claudette update              # Diff against HEAD~1
claudette update --base main  # Diff against main branch
```

**Watch mode** (auto-updates on file changes):

```bash
claudette watch
```

> Run `claudette watch` in a separate terminal while working. It detects file saves and
> incrementally updates the graph.

**Full rebuild** (if the graph gets out of sync):

```bash
claudette build
```

### Useful Commands

```bash
claudette status     # Show graph statistics (nodes, edges, files)
claudette visualize  # Generate interactive HTML graph visualization
```

### MCP Tools Available in Claude Code

| Tool                    | Usage                                                  |
| ----------------------- | ------------------------------------------------------ |
| `build_or_update_graph` | Initialize or refresh the graph                        |
| `query_graph`           | Find callers, callees, importers, children, tests      |
| `get_impact_radius`     | Analyze blast radius of changed files before refactors |
| `get_review_context`    | Generate focused review context for PRs                |
| `semantic_search_nodes` | Search for code entities by name or keyword            |

## Graft (Local Context Graph)

Prebuilt graph of every symbol, its `file:line` span, and who calls what, exposed as markdown cards
under `graft/` plus MCP tools. The `graft/` directory is **local-only**: it is gitignored and must
be built on each machine (`.ignore` re-admits the cards to ripgrep search).

### Installation

```bash
npm i -g @nanonets/graft
```

### Building the Graph

```bash
graft build          # Wiring graph + per-file cards (no LLM, no API key)
graft check          # Fail if graft/ is stale relative to the code
```

The MCP server refreshes the graph before each query, so uncommitted edits are reflected.

### Useful Commands

```bash
graft ask "<task>" --source   # Ranked nodes with code inlined at file:line
graft grep "<literal>"        # Every occurrence, grouped by enclosing symbol
graft skeleton <file>         # A file's API surface (signatures + spans)
graft callers <sym> --depth 2 # Callers / blast radius before a change
graft map                     # Repo orientation (clusters, hubs, hotspots)
```

### MCP Tools Available in Claude Code

| Tool                    | Usage                                          |
| ----------------------- | ---------------------------------------------- |
| `graft_find_code`       | "How does X work" / "where is Y", code inlined |
| `graft_find_all`        | Every occurrence of a literal                  |
| `graft_trace_calls`     | Callers, callees, blast radius                 |
| `graft_file_api`        | A file's whole API in a few hundred tokens     |
| `graft_repo_map`        | Orientation in the repo                        |
| `graft_check_freshness` | Check whether the graph is up to date          |

## Context7 (Library Documentation)

Fetches current documentation for any library or framework. No installation needed — runs via `npx`.

### MCP Tools Available in Claude Code

| Tool                 | Usage                                            |
| -------------------- | ------------------------------------------------ |
| `resolve-library-id` | Find the context7 ID for a library (e.g. vitest) |
| `query-docs`         | Fetch current docs for a resolved library        |

### Example Usage (in Claude Code)

> "Look up the vitest `vi.fn()` API docs using context7"

Claude will call `resolve-library-id` to find vitest, then `query-docs` to fetch the relevant
section.
