# MCP Tools Setup

This project uses two MCP servers to enhance Claude Code sessions.

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
