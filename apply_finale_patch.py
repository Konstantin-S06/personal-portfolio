"""Applies the finale edits (dirt path, centred contact card, throne room + chat) to existing files.
Run from the folder that contains src/:  python apply_finale_patch.py [src-folder]
All anchors are checked first; if any is missing or not unique, nothing is written. Backups: *.pre-finale.bak
"""
import sys
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "src")
HERE = Path(__file__).resolve().parent


class PatchError(Exception):
    pass


def locate(name):
    hits = [p for p in ROOT.rglob(name) if "node_modules" not in p.parts]
    if len(hits) != 1:
        raise PatchError(f"expected exactly one {name} under {ROOT}, found {len(hits)}")
    return hits[0]


# (file name, marker proving it is already patched, [(find, replace), ...])
EDITS = [
    ("world.ts", "createThroneRoom", [
        ("import { createCampfireFx, FIRE_GAZE } from './fire';\n",
         "import { createCampfireFx, FIRE_GAZE } from './fire';\n"
         "import { createDirtPath } from './dirtPath';\n"
         "import { createThroneRoom } from './throneRoom';\n"
         "import { walkProgress, throneProgress } from '../lib/timeline';\n"),
        ("  campfire.y = 0;\n",
         "  campfire.y = 0;\n\n  const room = createThroneRoom(endPt, endTan);\n  scene.add(room.group);\n"),
        ("    Math.hypot(x - campfire.x, z - campfire.z) >= L.CAMPFIRE_CLEARING + r &&\n",
         "    Math.hypot(x - campfire.x, z - campfire.z) >= L.CAMPFIRE_CLEARING + r &&\n    !room.blocks(x, z, r) &&\n"),
        ("  disposables.push(ground.geometry, ground.material as THREE.Material);\n",
         "  disposables.push(ground.geometry, ground.material as THREE.Material);\n\n"
         "  const dirt = createDirtPath([...pathCore, ...room.routePoints], campfire);\n"
         "  scene.add(dirt.group);\n  disposables.push(dirt, room);\n"),
        ("    const p = Math.min(Math.max(lastProgress, 0), 1);\n    curve.getPointAt(p, pos);\n",
         "    const pAll = Math.min(Math.max(lastProgress, 0), 1);\n    const p = walkProgress(pAll);\n"
         "    const tThrone = throneProgress(pAll);\n    curve.getPointAt(p, pos);\n"),
        ("    camera.position.copy(pos);\n    camera.lookAt(look);\n",
         "    if (tThrone > 0) {\n      room.cameraAt(tThrone, pos);\n"
         "      const fdist = Math.max(Math.hypot(campfire.x - pos.x, campfire.z - pos.z), 0.5);\n"
         "      const fpitch = Math.atan2(pos.y, fdist) - THREE.MathUtils.degToRad(FIRE_GAZE.baseDeg);\n"
         "      gazeAim.set(campfire.x, pos.y - fdist * Math.tan(fpitch), campfire.z);\n"
         "      room.gaze(tThrone, gazeAim, look);\n    }\n"
         "    camera.position.copy(pos);\n    camera.lookAt(look);\n"),
        ("    fireFx.update(clock, flyUniforms.uPx.value);\n",
         "    fireFx.update(clock, flyUniforms.uPx.value);\n    room.update(clock, camera.position);\n"),
    ]),
    ("fire.ts", "sideDeg: 0,", [("sideDeg: 10,", "sideDeg: 0,")]),
    ("look.ts", "PATH_CLEARANCE = 1.7", [("export const PATH_CLEARANCE = 1;", "export const PATH_CLEARANCE = 1.7;")]),
    ("chapters.ts", "'chat'", [
        ("'more' | 'cta';", "'more' | 'cta' | 'chat';"),
        ("const CONNECT: Chapter = { id: 'connect', title: \"Let's Connect\", kind: 'cta' };\n",
         "const CONNECT: Chapter = { id: 'connect', title: \"Let's Connect\", kind: 'cta' };\n"
         "const CHAT: Chapter = { id: 'chat', title: 'Ask About My Work', kind: 'chat' };\n"),
        ("...(hasMore ? [MORE] : []), CONNECT];", "...(hasMore ? [MORE] : []), CONNECT, CHAT];"),
    ]),
    ("stops.ts", "WALK_END", [
        ("import { chapterRanges, rangesFromCenters, type Range } from './progress';\n",
         "import { chapterRanges, rangesFromCenters, type Range } from './progress';\n"
         "import { CHAT_CENTER, WALK_END } from './timeline';\n"),
        ("const byId = new Map(rows.map((s) => [s.chapterId, s.progress]));",
         "const byId = new Map(rows.map((s) => [s.chapterId, s.progress * WALK_END]));"),
        ("const found = chapters.map((ch) => byId.get(ch.kind === 'project' ? `project-${++k}` : ch.id) ?? null);",
         "const found = chapters.map(\n    (ch) => (ch.kind === 'chat' ? CHAT_CENTER : byId.get(ch.kind === 'project' ? `project-${++k}` : ch.id)) ?? null,\n  );"),
    ]),
    ("Stage.tsx", "panel-chat", [
        ("${c.kind === 'more' ? ' panel-more' : ''}`}",
         "${c.kind === 'more' ? ' panel-more' : ''}${c.kind === 'cta' ? ' panel-cta' : ''}${c.kind === 'chat' ? ' panel-chat' : ''}`}"),
    ]),
    ("ChapterContent.tsx", "ChatPanel", [
        ("import { ContactForm } from './ContactForm';\n",
         "import { ChatPanel } from './ChatPanel';\nimport { ContactForm } from './ContactForm';\n"),
        ("      return <MoreArc title={title} projects={actions.moreProjects ?? []} />;\n",
         "      return <MoreArc title={title} projects={actions.moreProjects ?? []} />;\n"
         "    case 'chat':\n      return <ChatPanel title={title} />;\n"),
    ]),
    ("App.tsx", "label: 'Chat'", [
        ("    { id: contact?.id ?? 'connect', label: 'Contact' },\n",
         "    { id: contact?.id ?? 'connect', label: 'Contact' },\n"
         "    ...(chapters.some((c) => c.kind === 'chat') ? [{ id: 'chat', label: 'Chat' }] : []),\n"),
    ]),
]
CSS_MARK = "/* ==== Finale: contact centring and chat panel"


def main():
    for rel in ("lib/timeline.ts", "scene/dirtPath.ts", "scene/throneRoom.ts", "components/ChatPanel.tsx"):
        if not (ROOT / rel).exists():
            raise PatchError(f"missing new file {ROOT / rel}: unzip the pack into the project root first")
    pending = []  # (path, new_bytes)
    notes = []
    for name, marker, edits in EDITS:
        path = locate(name)
        raw = path.read_bytes().decode("utf-8")
        crlf = "\r\n" in raw
        text = raw.replace("\r\n", "\n")
        if marker in text:
            notes.append(f"{name}: already applied")
            continue
        for find, repl in edits:
            n = text.count(find)
            if n != 1:
                raise PatchError(f"{name}: anchor found {n} times (need 1):\n{find}")
            text = text.replace(find, repl)
        out = text.replace("\n", "\r\n") if crlf else text
        pending.append((path, out.encode("utf-8")))
        notes.append(f"{name}: patched")
    css = locate("styles.css")
    raw = css.read_bytes().decode("utf-8")
    if CSS_MARK in raw:
        notes.append("styles.css: already applied")
    else:
        add = (HERE / "finale.css").read_text(encoding="utf-8")
        crlf = "\r\n" in raw
        merged = raw.rstrip("\r\n") + "\n" + add
        merged = merged.replace("\r\n", "\n")
        pending.append((css, (merged.replace("\n", "\r\n") if crlf else merged).encode("utf-8")))
        notes.append("styles.css: patched")
    for path, data in pending:
        bak = path.with_name(path.name + ".pre-finale.bak")
        if not bak.exists():
            bak.write_bytes(path.read_bytes())
        path.write_bytes(data)
    print("\n".join(notes))


if __name__ == "__main__":
    try:
        main()
    except PatchError as e:
        print("NOTHING WRITTEN.", e)
        sys.exit(1)
