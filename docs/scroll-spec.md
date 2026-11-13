Scroll-Driven Depth Navigation: Implementation Spec
1. Overview of the effect
The page is a sequence of full-viewport stages. Each stage stays fixed on screen while the document keeps scrolling, and that extra scroll distance is turned into a single progress value from 0 to 1. Progress scrubs a pre-authored 3D camera path through a world, and the same clock fades HTML panels in and out over the picture. The viewer reads it as walking forward. The camera, a few scene motions, and the text are all locked to one smoothed scroll position.

2. Recommended stack and rationale
Piece	Role
Static site shell with client-only interactive islands
HTML chapters, navigation, and layout render as normal DOM. The 3D view mounts only in the browser, so a WebGL canvas is never server-rendered.
React as the island runtime
One component tree owns the canvas, the progress callback, and the loading gate.
Three.js
Scene graph, camera, fog, lights, animation mixer, and materials.
React bindings for Three.js
Declarative canvas, per-frame hooks, and suspense around the model load. Vanilla Three.js can replace this if the page is not React.
A glTF loader plus an environment-map helper
The world, its camera animation, and the sky image arrive as authored assets.
A scroll-pinning library with scrubbed progress
Pins the stage, measures a virtual scroll length, and eases the reported progress. GSAP ScrollTrigger is the reference tool. Any pin-and-scrub scroller with a 0–1 callback is equivalent.
A postprocessing composer
Bloom on bright pixels, plus one custom screen-space pass for the end flourish.
Utility CSS plus a small global stylesheet
Layout, stacking, and the chapter overlay transitions.
A dev-only numeric panel
Live-tunes fog, lights, and effect windows, then those numbers are copied into constants. It is not part of the shipped page.
Do not build this as CSS translateZ layers. Depth comes from a real perspective camera moving through one mesh scene. HTML sits in a separate layer on top of the canvas and shares only the progress number.

3. Core mechanic
Capture and normalize
Each stage is a viewport-sized, overflow-hidden section. A scroll trigger pins it when its top hits the viewport top. The pin lasts for several viewport heights (about 4.5 to 6). While pinned, progress is the fraction of that virtual distance the user has scrolled:


raw = clamp((scrollY - pinStart) / (pinEnd - pinStart), 0, 1)
Report one progress stream per stage. A second trigger on the same pinned element can freeze on a stale value when the pin spacer changes layout.

Smoothing
The trigger’s scrub lag is about 1 second. The value that drives the camera chases raw instead of matching it on the same frame. Fast flicks ease in behind the scrollbar. Scroll back and the camera eases back along the same path. There is no separate easing curve on the camera itself. The authored animation is sampled linearly in time. The scrub is the only damper.

Turn off CSS smooth scrolling while a script moves the scrollbar. A CSS smooth scroll fights the pin’s own scroll restoration and drops the view back at the top.

Map progress onto the camera
Author the walk in a 3D tool as a camera animation on a camera node that is a direct child of the scene root. Export it in the same glTF as the world. At runtime:


duration  = cameraClip.length
seekTime  = smoothedProgress * duration
for each scrubbed action:
    action.paused = false          // a finished clip pauses itself
    action.loop   = once
    action.holdLastFrame = true    // progress 1 must not wrap to frame 0
mixer.seek(seekTime)
renderCamera.position = authoredCamera.localPosition
renderCamera.rotation = authoredCamera.localRotation
Copy the local transform, not the world transform. A pointer-parallax offset lives on a parent group. Reading world space would bake that offset into the path.

If other clips must stay in sync with the walk (a gate opening, for example), play them on the same mixer and the same clock as the camera clip. Do not stretch each clip to fill the whole scroll. A shorter clip then finishes early and holds, which is what keeps a door open while the camera continues through it.

glTF animation does not carry field of view. Store the camera’s exported fov as the base, then add a scripted boost inside a progress window:


t   = clamp((progress - fovStart) / (fovEnd - fovStart), 0, 1)
fov = baseFov + fovBoostDegrees * t
updateProjection()
The same window helper drives every other scroll-linked scalar (fog, glow, a rising prop, a screen effect).

Programmatic travel
Navigation does not set the camera directly. It animates scrollY into the pin range so the scrubber plays the in-between frames.


target   = pinStart + (pinEnd - pinStart) * clamp(progress, 0, 1)
fraction = abs(target - scrollY) / max(pinEnd - pinStart, 1)
duration = clamp(0.8 + (2.0 - 0.8) * fraction, 0.8, 2.0)
tween scrollY to target with an ease-out curve
Ease-out only. An ease-in feels like a delay because the scrub already softens the first frames. If the target is within a pixel, jump and force the scroller to update. Keep a token so only the latest request may finish. After a stage swap, wait until that stage’s trigger exists (the model load is async), remeasure, then tween.

Parking a hidden stage
A hidden stage keeps its last canvas frame. Before showing it again, force progress to 0, seek the mixer there, and reset the document scroll to 0. Otherwise the old frame flashes.

4. Scene and layer architecture
The journey is two stages in series, not one continuous camera clip.

Stage A, the threshold. A small interior or doorway, on the order of a few dozen units. Pin length about 4.6 viewport heights. The camera clip is the master clock. A second, shorter clip (a door or gate) shares that clock, finishes, and holds. Tight colored fog and strong bloom are present at the start and clear as progress advances. A title group in the DOM fades out across a narrow band early in the pin.

Stage B, the walk. A long path, on the order of 50 units deep, pin length about 6 viewport heights. The camera clip is the whole walk. Field of view widens briefly near the start of the motion. In the last portion of the path a distant prop eases up into place, a warm local light sits beyond the final camera frame, and a screen-space swirl pulses in and back out. Ground mist near the destination is created only after progress enters that late window.

Only one stage is displayed. The other is removed from layout. Activating a stage kills the hidden stage’s scroll trigger so two pins never fight. Entering Stage B is an explicit handoff control that appears when Stage A progress is essentially complete (about 0.999).

Depth inside one stage
There are no stacked 2D planes. Depth is the scene itself:

Sky. An equirectangular environment image used as the background, blurred (around 0.35) so it reads as atmosphere. Rotate it so the bright horizon matches the key lights.
Far. Linear fog. On the short stage, fog starts a few units out and ends around the far wall. On the long stage, fog starts at the camera and ends near the full scene depth, otherwise the whole walk disappears.
Mid. The authored set: ground, structures, and the path the camera travels.
Near. Props close to the camera. They move fastest because of perspective, which sells the walk.
Screen. Bloom, then the end swirl. These are image effects, not objects in the scene.
DOM. A full-bleed overlay above the canvas. Chapters occupy the same rectangle and crossfade. They are not projected into 3D.
The canvas is the back layer and ignores pointer events, so scrolling and buttons hit the page. Decorative strokes sit above the canvas and below the text. Chapter panels sit above that. A chapter chip, the handoff button, and the site navigation sit higher still.

Module split
Stage shell. Viewport section, pin target, active or hidden state.
Scene view. Client-only canvas, lights, fog, model, post effects.
Progress bridge. The one scroll trigger. Calls “apply progress” and notifies the chapter controller.
Camera scrubber. Mixer seek plus fov and any extra windows.
Chapter overlay. Static HTML panels marked with a chapter id.
Chapter controller. Writes opacity, offset, visibility, and pointer events from progress.
Stage switcher. Shows one stage, parks the other at frame 0, resets scroll.
Navigator. Maps a section id to a stage and a progress, then tweens scroll.
Loading gate. Covers the stage until the model reports complete, then reveals the intro.
Dev tuner. Optional. Omit from production.
Pointer parallax is a separate group around the meshes, not around the render camera. Each frame, normalize the pointer to about −1…1 and ease a target toward it:


offset += (pointerTarget - offset) * 0.08
group.x =  offset.x * 0.22
group.y = -offset.y * 0.22
The scene drifts a fraction of a unit toward the pointer. Strength around 0.22 and a per-frame lerp around 0.08 are the starting point. Stop requesting frames once the offset is within about 0.001 of the target, unless something else is still animating.

5. Stops and sections system
Chapters are progress ranges on the active stage, not positions in the 3D file. A practical layout is:

Stage A: a short opening band from 0 to about 0.2 with the title only, then one content chapter from about 0.2 to 1.
Stage B: four equal quarters, 0–0.25, 0.25–0.5, 0.5–0.75, 0.75–1.
Each panel is absolutely stacked in the same full-viewport box, centered, with a readable max width near 1100 pixels and its own vertical scroll if the copy is tall.

Opacity for a chapter spanning start…end:


fade     = min((end - start) * 0.2, 0.08)
fadeIn   = (start == 0) ? 1 : clamp((progress - start) / fade, 0, 1)
fadeOut  = (end == 1)   ? 1 : clamp((end - progress) / fade, 0, 1)
opacity  = min(fadeIn, fadeOut)
The first chapter is already fully visible. The last chapter does not fade out. Apply:

opacity as above
translateY = (1 - opacity) * 28px so the panel rises into place as it appears
visibility hidden when opacity is about 0
pointer events only when opacity is above 0.5
an active class above 0.5, used for anything that should ignore the exit transition delay
A CSS transition of about 220ms on opacity and transform softens the HTML. Any overlay that is updated on every scroll tick (the title fade) must have its CSS transition cleared, or the transition lags a full beat behind the camera.

Also write progress onto the stage as a CSS variable, set a “complete” flag near 0.999 for the handoff button, and store the active chapter id on the stage. Broadcast a chapter-change event when the id changes. A small polite live region can announce the chapter name.

Navigation lands slightly inside the fade, where the panel is already opaque:


landing = (start == 0) ? start + fade : start + fade * 1.25
Allow a per-section override when a chapter should open on a framed moment instead of the computed landing.

The title group on Stage A fades across its own window, about 0.15 to 0.25, from opaque to invisible. Below half opacity it stops receiving pointer events. That fade is independent of the chapter opacity function.

Deep links use a query parameter naming the section. Read it once after the loading gate fires, scroll to that landing, and strip the parameter so a refresh does not jump again.

6. Animation parameters
Treat every number as a starting point.

Parameter	Starting value	What it tunes
Stage A pin length
460% of the viewport
Scroll spent in the threshold
Stage B pin length
600% of the viewport
Scroll spent on the walk
Scrub lag
1 second
How far the camera trails the scrollbar
Pin anticipation
1
Reduces the jump as the pin engages
Base fov
about 35°
Perspective. Prefer the fov baked on the exported camera
Fov boost
+15°
Extra widen on the walk
Fov window
0.17 → 0.20
Short early widen, then hold
Clip near / far
0.1 / 200 on the long stage
Raise far with scene size
Interior fog
near 4, far 18
Tight fade in the small room
Walk fog
near 0, far ~60
Fade across the long set
Atmosphere fade start
progress 0.08
When Stage A fog and bloom begin clearing
Fog fade curve
power 0.4
Below 1 front-loads the clear
Bloom fade curve
power 0.22
Glow clears before fog does
Fog far while clearing
baseFar / (1 - fade), capped very high
A linear lerp of far looks like a pop. Dividing by the remaining fade grows it smoothly
Bloom, threshold
interior ~6, walk ~1.2, threshold 0.8
Only very bright pixels glow. The long scene needs less or the sky blows out
Bloom mip blur
on
Softer, cheaper glow
Parallax strength
0.22 world units
Scene shift at the screen edge
Parallax lerp
0.08 per frame
Pointer follow smoothing
Chapter fade length
min(20% of the chapter, 0.08 progress)
Crossfade width
Chapter rest offset
28px down
Hidden pose
Chapter transition
220ms ease
Opacity and transform
Hit-test threshold
opacity 0.5
When a panel becomes interactive
Title fade window
0.15 → 0.25
Opening type leaves
Intro veil
0.6s ease-out
Cover over the first frame
Intro items
0.6s, stronger ease-out, stagger 0.08s, from 8px down
Title group entrance
Load settle
350ms after the loader hits 100%
Avoids a one-frame pop
Load cover fade
700ms, strong ease-out
Cover leaves
Handoff reveal
240ms ease, from 14px down
Continue control
Jump duration
0.8s to 2.0s by distance, ease-out
Chapter and stage changes
Idle cutoff
progress 0.92
Wind, spin, and particles stop so the loop can sleep
Foliage wind
speed 0.5, strength 0.3
Tip sway. Weight by height so roots stay put. Phase from world XZ
Falling cards
about 15, fall speed ~0.75, sway ~0.5
Sparse, instanced, only on the first stage
Constant spin
about one turn every 10 seconds
A single prop, in real time, not on the scroll clock
Rising prop window
0.75 → 1.0
Late on the walk
Rise amount
starts about 6 units below its rest pose
Eased with smoothstep
Swirl window
0.85 → 1.0
End of the walk
Swirl envelope
sin(window × π)
Rises and falls. It does not hold
Swirl taps
8 samples
Radial blur toward center, up to about 14% zoom
Swirl twist
up to ~0.35 radians, modulated by a slow sine
Slight rotation wobble
Chromatic split
about 1% of the frame along the radius
Color fringe at full strength
Vignette
tightens with progress, mixed in at about half strength
Darkens the corners during the pulse
Warm flash
a small warm add, cubed by progress, slowly pulsing
The flare at the center of the pulse
Sky blur
about 0.35
How soft the environment background is
Exposure
1, filmic tone map
Overall brightness
Pixel ratio
clamped from 1 to 1.5
Sharpness versus fill rate
Shadow map
4096 on the single shadow-casting light, soft variance shadows
Quality setting. Drop this first on small screens
Narrow layout
under 768px
Swap in the lighter world asset at startup
Button hover
about 300ms, slight brighten and lift of 1px
Glass controls only
Continuous motion (wind, particles, spin, swirl time) uses the frame clock. The walk itself uses only scroll progress. Past the idle cutoff, stop requesting frames unless the swirl is still visible or the pointer offset is still catching up.

7. Performance, mobile, and accessibility requirements
Loading. Show a full-viewport cover until the model loader reports complete. Hold a fraction of a second, fade the cover, then run the intro. The second stage does not start its trigger until the viewer enters it. Mist at the end of the walk is built only after progress crosses into that window. Suspend the canvas contents until the file arrives.

Assets. Ship the world as glTF. Provide a reduced variant for narrow screens and choose it once, when the island mounts, with a viewport query around 768px. The sky is one equirectangular image. Foliage cards that would blend should be converted to alpha-tested cutouts so they write depth and sort correctly. Share one time uniform across every wind material. Particles are a single instanced mesh, with opacity fading in at the top of the fall and out at the bottom. One shadow-casting directional light is enough. A warm point or spot near the destination sells the end of the path without a second shadow map.

Frame rate. Render on demand. Invalidate a frame when progress changes, while parallax is settling, and while an idle effect is running. Stop those idle effects after about 92% progress. Cap device pixel ratio around 1.5. Keep the canvas from receiving pointer events. On resize, remeasure the pin and redraw. Alpha-test foliage, instancing, and a single post stack (bloom, then the swirl) are the main cost controls. The swirl pass must be allowed to sample neighboring pixels. A convolution or equivalent full-screen pass is required.

Touch and small screens. The same vertical scroll drives the camera. There is no separate drag-to-move gesture. Use the lighter model under the breakpoint. A disclosure menu for navigation should close on Escape and when the viewport grows past the desktop breakpoint. Section links call the same progress navigator as desktop.

Accessibility, as built. The canvas wrapper is removed from the accessibility tree. The chapter name is exposed in a polite live region. Panels that are faded out do not take pointer events, so focus and clicks land on the visible chapter. Keyboard scrolling (space, arrows, page keys) moves the camera because the camera is the scrollbar. Escape closes the mobile menu. The only reduced-motion handling in the reference is disabling one small toast animation. The pinned camera journey still runs.

Accessibility to add in a new build. When the user prefers reduced motion, skip the pin. Lay the same chapters out as normal document sections, show one still frame or a paused camera pose per stage, and do not run wind, particles, spin, or the swirl. Keep every chapter reachable from the nav and from the keyboard in source order. Provide a text alternative for anything the 3D image communicates that the chapter copy does not. Respect reduced motion on the loading indicator loop as well.

8. Abstract style guide
Mood. Two beats. The first is a bright, airy, daylight illustration: soft sky, gentle distance haze, playful idle motion. The second is a deeper cool dusk walk, with the sky darkening toward the horizon and a single warm practical light at the destination. The end of the walk briefly turns dreamy (radial blur, a little color fringe, a warm flash) and then settles.

Materials. Stylized and matte. Hero props use roughness near 1, very low metalness, and little environment reflection so they do not look like plastic. Foliage is flat cutout cards with a slow tip sway. Clouds and ground mist are soft, low-opacity volumes. Shadows are soft. Highlights bloom only where they are genuinely bright.

Color roles. Outside the stages, the page is warm paper with two faint corner washes, one warm and one cool. Stage A’s atmosphere is a light sky color, and its fog matches that sky. Stage B’s page behind the canvas is near-black, and its fog is a deep cool tone. Type over the 3D image is white, with a soft glow on the opening title. Interactive controls are translucent dark glass: a hairline light border, a backdrop blur around 20px, and a faint inner highlight in the sky accent. The destination light is warm. Accents stay saturated and are reserved for controls and small labels. Body text on paper sections uses a dark ink and a muted secondary.

Type. A geometric or rounded display sans for titles, the chapter chip, and buttons. A neutral body sans for paragraphs. Kickers are tiny, heavy, uppercase, and widely tracked. The chapter chip is a small pill, uppercase, slightly tracked out, on a blurred dark scrim. Title scale is fluid, from a large mobile size up to a display size near the width of the column. Body line height is relaxed, around 1.7.

Space. Each stage is exactly one viewport tall. The text column caps near 1100 pixels. Chapter padding is generous at the top to clear the navigation, tighter at the sides, and uses fluid clamps. Sections on the paper page use a wide vertical rhythm, around 80px, reduced on small screens. Buttons are pill-shaped on the glass controls and slightly squared on the paper page.

Motion feel. The walk is heavy and continuous because of the one-second scrub. Jumps between chapters still play the path, they just compress it into under two seconds. HTML fades are short, around 200–250ms, with an ease-out and no bounce or spring. Idle motion is slow: foliage barely moves, one prop turns about once every ten seconds, a handful of cards drift down. Hover on glass is a small brighten. Hover on paper buttons is a one-pixel lift.

9. Suggested build order
Pinned progress. One full-viewport section, a pin of several screen-heights, a 0–1 readout, and a one-second scrub. Confirm scroll up and scroll down both track, including after a resize.
A placeholder camera path. Even a straight lerp from a start pose to an end pose is enough to prove the mapping. Then replace it with a clip exported from a camera node.
Seek safely. Loop once, hold the last frame, unpause before every seek, and copy the local camera transform onto the render camera.
One authored world. Sky image, one shadow-casting light, linear fog, filmic tone mapping, demand rendering, pixel-ratio cap.
Chapter overlay. Two ranges, the opacity and 28px offset rules, pointer events, and the live region. Confirm the title fade does not fight a CSS transition.
Navigation. Tween scroll position into a chapter landing. Block CSS smooth scrolling during the tween. Ignore stale requests.
Second stage. Hidden until a handoff at the end of the first. Park the hidden camera at frame 0. Reset scroll on entry.
Synced secondary clip. A gate or similar on the camera’s clock, shorter than the camera clip, so it completes and holds.
Effect windows. Fov boost, fog and bloom clear using the reciprocal-far fade, the rising prop, and the end swirl with a sine envelope.
Idle life. Wind shader, a few instanced drifting cards, one constantly spinning prop, all stopped past the idle cutoff.
Loading and intro. Cover until the loader finishes, short hold, fade, staggered intro. Defer the second stage and the destination mist.
Narrow screens. A lighter model chosen at startup. Collapse the nav under the breakpoint.
Reduced-motion layout. The same chapters in normal document flow, with stills instead of the pin.
Tune, then delete the tuner. Adjust the table in section 6 by eye, bake the numbers, and ship without the dev panel.
10. Placeholders list
The implementer supplies all of the following. Nothing in this spec is a stand-in for them.

The 3D world for each stage, modeled and exported as glTF, including a reduced variant for narrow screens.
A camera animation authored on a root-level camera node in each file, plus any secondary clip that must stay in sync (a door, a gate, a drawer).
An equirectangular sky image per stage, and the rotation that lines its bright area up with the lights.
All set dressing, foliage textures, and any particle card texture.
Every word of copy, headings, button labels, and chapter names.
The color palette: paper background, ink, muted text, sky fog, night fog, warm destination light, glass fill, and accent.
The display face and the body face. Use properly licensed or open fonts.
Section ids, how many chapters each stage has, and their progress ranges.
The actual path of the camera through the space. This spec only defines how scroll samples a path.
Iconography, logos, and any loading animation beyond a plain cover.
Backend, forms, analytics, and hosting. This effect is entirely client-side.
Self-check: removed or generalized
Scanned the spec for proper nouns, brand names, hex codes, asset names, URLs, and copied source. None of those remain. The following were dropped or rewritten while reading the implementation:

Organization, event, and sponsor identities, slogans, dates, and places.
All on-screen labels, replaced by roles such as “chapter,” “title group,” and “handoff control.”
Model file names, sky-image names, node names inside the scenes, and any description detailed enough to rebuild a specific prop or character.
Every hex color and every custom font family name. Color is described by role. Type is described by category.
File paths, repository identity, contributor names, and comments that named the project.
Environment details, endpoints, and query-parameter spellings. Deep linking is described only as “a section parameter.”
Shader source. The end effect is described as an 8-tap radial zoom, a small time-varying twist, a radial color split, a tightening vignette, and a warm pulse.
Exact light coordinates, shadow-frustum sizes, and sky-shader coefficients. Lights are described as one cool key, one stronger shadow-casting key, and one warm destination light.
Animation-mixer and scroll-trigger calls. The seek, pin, and chapter math is new pseudocode of the same behavior.
The specific cast of idle props. They are described as foliage cards, a handful of falling cards, and one slowly spinning part.