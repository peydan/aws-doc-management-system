---
name: drawio
description: Always use when user asks to create, generate, draw, or design a diagram, flowchart, architecture diagram, ER diagram, sequence diagram, class diagram, network diagram, mockup, wireframe, or UI sketch, or mentions draw.io, drawio, drawoi, .drawio files, or diagram export to PNG/SVG/PDF.
---

# Draw.io Diagram Skill

Generate draw.io diagrams as native `.drawio` files. Author each diagram either as **Mermaid** (concise text that the draw.io desktop CLI converts and lays out for you) or as **draw.io XML** directly. Optionally auto-layout XML-authored diagrams with **ELK**, export to PNG/SVG/PDF with the diagram XML embedded (so the exported file stays editable in draw.io), or generate a browser URL that opens the diagram directly in the draw.io editor.

## Authoring: Mermaid or XML?

The desktop CLI can convert Mermaid to a native `.drawio` file, so **prefer Mermaid** for the diagram types it handles well — its parser lays the diagram out automatically, which is far more reliable than hand-positioning cells in XML.

| Author as | Best for | Needs desktop CLI? |
|-----------|----------|--------------------|
| **Mermaid** | Flowcharts, sequence, class, state, ER, gantt, mindmap, timeline, user journey, quadrant, C4, git graph, pie, and other standard types | Yes — to convert to `.drawio` |
| **XML** | Custom styling, precise/hand positioning, specific shape libraries (AWS, Azure, network, UML detail…), or when the desktop CLI is not installed | No (optional ELK `--layout` needs the CLI) |

- **Prefer Mermaid** when the desktop CLI is available and the request is one of the standard types above — write terse Mermaid and let draw.io lay it out.
- **Use XML** for precise control, or as the universal fallback: XML needs no CLI at all, so it's the only option when the desktop app isn't installed (output a `.drawio` file or a `url`).
- For XML-authored diagrams you can ask the CLI to apply an **ELK auto-layout** (`--layout`) instead of computing coordinates yourself — the same layouts the draw.io editor's *Arrange ▸ Layout* menu applies, and the same engine the draw.io MCP app server uses. See [ELK layout for XML](#elk-layout-for-xml).

If you're unsure whether the desktop CLI is present, detect it first (see [Locating the CLI](#locating-the-cli)). No CLI → author as XML and deliver a `.drawio` file or a `url`.

## The pipeline

Every diagram becomes a native `.drawio` file first, then is delivered in the requested output format. This keeps the delivery step identical whether you authored Mermaid or XML.

1. **Author → `.drawio`**
   - **Mermaid**: write the Mermaid to a `.mmd` file, then convert it with the CLI:
     ```bash
     drawio -x -f xml -o diagram.drawio diagram.mmd
     ```
     Delete the `.mmd` afterward — the `.drawio` is the artifact. draw.io's Mermaid parser has already laid the diagram out, so no `--layout` is needed.
   - **XML**: write the mxGraphModel XML to `diagram.drawio` (see [XML format](#xml-format)). Optionally apply an ELK layout (see [ELK layout for XML](#elk-layout-for-xml)).
2. **Deliver** (identical for both sources):
   - *(no format)* → keep `diagram.drawio` and open it.
   - **png / svg / pdf** → export from the `.drawio` with embedded XML, then delete the source `.drawio`:
     ```bash
     drawio -x -f png -e -b 10 -o diagram.drawio.png diagram.drawio
     ```
   - **url** → build a browser URL from the `.drawio` XML, open it, and keep the `.drawio` as a local copy (see [Browser URL output](#browser-url-output)).
3. **Open the result** — the exported file, the URL, or the `.drawio`. If the open command fails, print the absolute path (or URL) so the user can open it manually.

**Always convert Mermaid to `.drawio` first, then export** — do not export a `.mmd` straight to an image. Direct Mermaid → PNG export with `-e` is broken in current draw.io Desktop (the embedded-XML step crashes); the two-step path (convert, then export the `.drawio`) is reliable and produces an editable embed. See [Troubleshooting](#troubleshooting).

If Mermaid was requested but no desktop CLI is available, fall back to authoring the same diagram directly as XML.

## ELK layout for XML

XML-authored diagrams can be auto-positioned by the CLI's `--layout` pass — the same ELK layouts as the editor's *Arrange ▸ Layout* menu and the same engine the draw.io MCP app server uses. Generate the cells with approximate (or even `0,0`) positions and let ELK place them; you only have to get the graph *structure* — nodes and edges — right.

Add `--layout <name>` to any CLI call that reads your XML. The simplest form lays out in place after you write the file (reading and overwriting the same path is supported):

```bash
drawio -x -f xml --layout verticalFlow -o diagram.drawio diagram.drawio
```

Or combine layout with export in a single call (works for XML input):

```bash
drawio -x -f png -e -b 10 --layout verticalFlow -o diagram.drawio.png diagram.drawio
```

### Layout presets

| Name | Layout |
|------|--------|
| `verticalFlow` | Layered, top-to-bottom — flowcharts, pipelines |
| `horizontalFlow` | Layered, left-to-right |
| `verticalTree` | Tree, top-down — hierarchies, org charts |
| `horizontalTree` | Tree, left-to-right |
| `radialTree` | Radial tree |
| `organic` | Force-directed — networks, mind-map-like graphs |

### Custom layout JSON

For finer control, pass a JSON **array** (starting with `[`) instead of a preset name — the same format as the editor's custom-layout dialog:

```bash
drawio -x -f xml --layout '[{"layout":"elkLayered","config":{"elk.direction":"RIGHT"}}]' -o diagram.drawio diagram.drawio
```

Each entry is `{"layout": <algorithm>, "config": { … }}`:

- **Algorithms**: `elkLayered`, `elkTree`, `elkRadial`, `elkOrganic`, `elkStress`, `elkBox`.
- **`config`**: keys starting with `elk.` are ELK options — e.g. `elk.direction` (`UP` / `DOWN` / `LEFT` / `RIGHT`), `elk.spacing.nodeNode`, `elk.layered.spacing.nodeNodeBetweenLayers`. The keys `edgeStyle` (e.g. `orthogonal`) and `corners` (e.g. `rounded`) control connector rendering.

### Orthogonal edge routing

`--layout libavoid` routes the **edges** orthogonally around the shapes (the editor's *Arrange ▸ Layout ▸ Orthogonal Routing*) without moving any vertex — the complement of the node layouts above. Use it as an in-place pass on hand-positioned XML whose connectors cross shapes:

```bash
drawio -x -f xml --layout libavoid -o diagram.drawio diagram.drawio
```

Skip it after a flow/tree preset — those already route their edges.

**When to use it:** author the graph structure as XML without worrying about coordinates, then apply `verticalFlow` / `horizontalFlow` for flow-style diagrams or `organic` for networks. Mermaid-authored diagrams are already laid out — don't add `--layout`.

## Mermaid syntax reference

When authoring Mermaid, consult the shared Mermaid reference:

[references/mermaid-reference.md](./references/mermaid-reference.md)

Match the language of the diagram labels to the user's language.

## XML syntax reference

When authoring XML, consult the shared XML reference:

[references/xml-reference.md](./references/xml-reference.md)

## Choosing the output format

Check the user's request for a format preference. Examples:

- `drawio create a flowchart` → Mermaid → `flowchart.drawio`
- `drawio png flowchart for login` → Mermaid → `login-flow.drawio.png`
- `drawio svg: ER diagram` → Mermaid → `er-diagram.drawio.svg`
- `drawio pdf AWS architecture overview` → XML (needs AWS shapes) → `architecture-overview.drawio.pdf`
- `drawio url flowchart for user login` → open
