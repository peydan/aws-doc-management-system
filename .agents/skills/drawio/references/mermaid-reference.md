# Mermaid Reference

Short hints for generating Mermaid diagrams that render correctly in draw.io. draw.io's Mermaid parser covers 28 diagram types — the header keyword on the first non-directive line selects the type.

## General rules

- **Pick the type keyword carefully.** `graph`/`flowchart`, `classDiagram`, `stateDiagram-v2`, `erDiagram`, `sequenceDiagram`, `gitGraph`, `journey`, `pie`, `gantt`, `mindmap`, `timeline`, `quadrantChart`, `requirementDiagram`, `sankey-beta`, `xychart-beta`, `block-beta`, `c4Context`/`C4Container`/`C4Component`, `architecture-beta`, `radar-beta`, `packet-beta`, `venn-beta`, `treemap-beta`, `treeView-beta`, `ishikawa-beta`, `kanban`, `zenuml`, `wardley-beta`, `eventmodeling`. Misspelling the header yields a blank diagram.
- **No trailing punctuation on node IDs.** IDs are identifiers (`myNode`, `node_1`, `A`) — spaces, hyphens (in some contexts), and reserved words (`end`, `class`, `subgraph`) break the parse. Put display text in brackets or quotes instead: `A["User's Account"]`.
- **One statement per line.** Separate statements with newlines; `;` works as a delimiter in flowchart but not everywhere.
- **Quote labels with special characters** (`:`, `-`, parentheses, non-ASCII). Use `"` not `'`.
- **HTML in labels:** only `<br>`, `<b>`, `<i>`, `<u>` are reliable across types. Use `#` for hex colors in styles, never `rgb()`.
- **Diagrams can take a title block** for some types:
  ```
  ---
  title: My Diagram
  ---
  flowchart TD
  ```
- **Match the language of labels to the user's language** — if the user writes in German, French, etc., the diagram labels should be in that language too.

## Flowchart (most common)

```
flowchart TD
  A[Start] --> B{Decision?}
  B -->|Yes| C[Do thing]
  B -->|No| D[Skip]
  C --> E((End))
  D --> E
```

- **Direction:** `TD`/`TB` (top-down), `BT`, `LR`, `RL`.
- **Node shapes by bracket:** `[rect]`, `(rounded)`, `([stadium])`, `[[subroutine]]`, `[(cylinder)]`, `((circle))`, `{rhombus}`, `{{hexagon}}`, `[/parallelogram/]`, `[\parallelogram alt\]`, `[/trapezoid\]`, `>asymmetric]`.
- **Edges:** `-->` arrow, `---` no arrow, `-.->` dotted, `==>` thick, `<-->` bidirectional. Inline label: `A -- text --> B` or `A -->|text| B`.
- **Subgraphs:**
  ```
  subgraph Frontend
    A --> B
  end
  ```

### Styling & colors

Three ways — pick one, don't mix for the same node:

**1. Inline per-node (`style`):**
```
flowchart LR
  A[Start] --> B[End]
  style A fill:#f9f,stroke:#333,stroke-width:2px,color:#fff
  style B fill:#bbf,stroke:#f66,stroke-dasharray:5 5
```

**2. Reusable classes (`classDef` + `:::`):**
```
flowchart LR
  A:::happy --> B:::sad
  classDef happy fill:#dfd,stroke:#0a0
  classDef sad fill:#fdd,stroke:#a00
```
Or apply to many: `class A,B,C happy`.

**3. Link styling (edges):**
```
linkStyle 0 stroke:#f00,stroke-width:3px
linkStyle default stroke:#999
```
`0` = first edge in order defined; `default` targets unstyled edges.

Style properties that work: `fill`, `stroke`, `stroke-width`, `stroke-dasharray`, `color` (font color).

## Sequence diagram

```
sequenceDiagram
  participant U as User
  participant S as Server
  U->>S: Request
  S-->>U: Response
  Note right of S: Logged
```

- **Arrows:** `->` (no head), `->>` (arrow), `-->>` (dashed), `-x` (X end), `--x` (dashed X).
- **Activate/deactivate:** `activate S` / `deactivate S` or `S->>+S2: call` / `S2-->>-S: return`.
- **Blocks:** `alt/else/end`, `opt/end`, `loop/end`, `par/and/end`, `critical/option/end`.
- **Notes:** `Note left of A`, `Note over A,B: text`.
- Optional `autonumber` after header numbers the messages.

## Class diagram

```
classDiagram
  class Animal {
    +String name
    +int age
    +eat() void
  }
  class Dog
  Animal <|-- Dog : inherits
  Dog "1" --> "*" Bone : has
```

- **Relations:** `<|--` inherit, `*--` composition, `o--` aggregation, `-->` association, `..>` dependency, `..|>` realize, `<-->` bidirectional.
- **Visibility:** `+` public, `-` private, `#` protected, `~` package.
- **Annotations:** `<<interface>>`, `<<abstract>>`, `<<enumeration>>` inside the class block or via `Animal <<interface>>`.
- **Cardinality:** quoted strings flanking the arrow (`"1"`, `"0..*"`, `"*"`).

## State diagram

```
stateDiagram-v2
  [*] --> Idle
  Idle --> Running : start
  Running --> Idle : stop
  Running --> [*]
  state Running {
    [*] --> Working
    Working --> Waiting : block
    Waiting --> Working : unblock
  }
```

- Use `stateDiagram-v2`, not `stateDiagram` (v1 is legacy).
- `[*]` = start (source) or end (target) depending on direction.
- `state X { ... }` nests a compound state; `state fork1 <<fork>>`, `<<join>>`, `<<choice>>` mark junction nodes.
- Transition labels: `A --> B : event [guard] / action`.

## ER diagram

```
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE-ITEM : contains
  CUSTOMER {
    string name
    string email PK
  }
```

- **Cardinality symbols:** `|o` zero-or-one, `||` exactly-one, `}o` zero-or-many, `}|` one-or-many. Mirror on both sides (e.g., `||--o{`).
- Attribute blocks list `type name [PK|FK|UK]` plus optional comment in quotes.
- Entity names are typically UPPERCASE by convention.

## Journey

```
journey
  title Morning routine
  section Wake up
    Coffee: 5: Me
    Read news: 3: Me
  section Commute
    Drive: 2: Me, Traffic
```

Each task: `Name: score(1-5): Actor[, Actor...]`. Section headers group tasks.

## Pie

```
pie showData title Browser share
  "Chrome" : 60
  "Firefox" : 20
  "Safari" : 20
```

`showData` is optional (renders the numbers). Quotes on labels, colon, numeric value.

## Gantt

```
gantt
  title Project timeline
  dateFormat YYYY-MM-DD
  section Phase 1
  Design : a1, 2025-01-01, 7d
  Build  : after a1, 14d
  section Phase 2
  Test   : 2025-01-25, 5d
```

- `dateFormat` is mandatory.
- Task line: `Name : [id,] [after id | YYYY-MM-DD], duration[d/w]`.
- Status tags: `done`, `active`, `crit` before the id (`crit a1`).

## Gitgraph

```
gitGraph
  commit
  branch develop
  checkout develop
  commit
  commit
  checkout main
  merge develop
```
