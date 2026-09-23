# The brief

This is the brief Summer Cycle was built from, unedited. The list after it says where the game
ended up going beyond it.

---

Ghibli-Style Cycling Game — Browser Build

The Game

Build a third-person cycling game in Three.js with a Studio Ghibli / Makoto Shinkai art style. A character rides a bicycle through a japanese countryside road. No combat, no score, no objectives — just ride and enjoy the scenery. This is a cinematic experience for a 30-40 second screen recording.

Art Direction — THIS IS THE MOST IMPORTANT SECTION

The entire build lives or dies on matching this aesthetic. Reference: Studio Ghibli films (My Neighbor Totoro, Spirited Away countryside scenes), Makoto Shinkai films (Your Name, Weathering With You background art).

Visual rules
Painterly, not photorealistic — colors should look like watercolor/gouache paintings
Custom toon/cel shader on ALL materials — flat base color + one shadow step + rim light
Bold dark outlines on geometry edges (2-3px)
Warm golden afternoon light — everything bathed in late-summer glow
Soft color palette: warm greens, muted yellows, sky blues, earthy browns
NO harsh shadows — soft, diffused lighting everywhere
Clouds must be fluffy, volumetric-looking, Ghibli-style cumulus — not flat planes
Sky gradient: deep blue at top → warm white/light blue at horizon
Atmosphere/haze near the horizon — distance fog with warm tint

Shaders (critical)
Toon shader with 2-3 color steps (lit, shadow, dark shadow) instead of smooth PBR
Outline pass using inverted hull method or post-processing edge detection
Painterly texture overlay on surfaces — subtle brush stroke pattern blended on top of flat colors
Sky shader with gradient + procedural cloud shapes

Environment — Japanese Countryside Road
The road: Narrow asphalt road with no lane markings — rural japanese country road. Slight curves winding through the landscape. Road edges blend into grass/dirt naturally — no harsh curbs. Subtle cracks and wear on the asphalt (toon-shaded, not photorealistic)
Rice fields (left side of road): Flooded rice paddies with bright green rice shoots. Water reflections of the sky visible between the plants. Wooden/bamboo fences separating paddies. Extends into the distance with slight elevation changes
Traditional buildings (right side, scattered): 2-3 traditional japanese wooden houses with dark tile roofs. Wooden walls, paper screens, small balconies. One small shop/cafe with a hanging fabric sign (noren). An AC unit on one wall (the classic Ghibli detail). Warm light glowing from inside windows
Vegetation: Lush green trees — rounded canopy shapes, not individual leaves. Use clusters of overlapping sphere-like shapes for tree canopies, painted green. Tall grass along the roadside swaying gently. Wildflowers — small colored dots scattered in grass patches. Vines and climbing plants on fences and walls
Infrastructure: Wooden power poles with sagging power lines crossing the road. A wooden fence/guardrail along parts of the road. Road signs (yellow diamond warning signs). One red post box (iconic japanese mailbox)
Sky: Gradient: deep cerulean at zenith → warm white at horizon. Large fluffy cumulus clouds — Ghibli-style, not realistic. Subtle yellow butterflies floating near flowers (particle system). Warm sun from behind/above — god rays optional

The Character + Bicycle
Character: Low-poly anime-style figure sitting on a bicycle. Simple body: head (sphere with flat face), torso (box), arms and legs (cylinders). School uniform or casual clothes — flat colored with toon shader. Hair: simple mesh shape, dark color, slight movement. NOT detailed — think Ghibli background characters, not protagonists. Cel-shaded with the same outline pass as everything else
Bicycle: Simple frame geometry — two wheels (torus), frame (cylinders), handlebars, seat. Red or blue frame color. Wheels rotate with forward movement. Pedals rotate — legs move in sync (simple IK or keyframe animation)
Animation: Pedaling: legs cycle up and down on the pedals. Slight body lean into turns. Hair/clothes sway slightly with movement. Handlebar turns with steering input

Camera: Third person, behind and slightly above the character. Follows smoothly with slight lag — not rigid. Camera height: just above the character's head level. Shows the road ahead and surrounding scenery. Slight camera sway with the bike movement for organic feel

Controls: Up arrow / W: pedal faster (auto-moves forward at base speed). Down arrow / S: brake / slow down. Left arrow / A: steer left. Right arrow / D: steer right. No jump, no dismount — just ride. Speed range: gentle cruise to moderate speed, never racing-fast. Smooth steering, not twitchy

Collision: Stay on the road — gentle invisible guide rails prevent going into rice fields. Can't ride through buildings or power poles. Simple AABB or sphere collision on major objects. If you hit something, just stop — no crash physics, no damage

Audio (all synthesized — Web Audio API): Bicycle chain/pedaling: rhythmic clicking that speeds up with pedaling. Wind: soft white noise that increases with speed. Birds: occasional chirping (random pitched oscillator bursts). Ambient: gentle background hum of countryside. No music track (the ambient sounds ARE the soundtrack). All synthesized at runtime, nothing downloaded

Render / Output: 1920x1080. 60fps. Post-processing: toon outline pass, subtle bloom on sunlit areas, warm color grading, soft vignette. No SSAO — keep it flat/painterly. Deploy on Vercel or GitHub Pages

Do NOT: Make it photorealistic — this is painterly/toon. Use standard PBR materials — everything must use toon/cel shader. Download any assets — all geometry, textures, and audio generated in code. Add combat, enemies, objectives, or scoring. Add UI except a subtle speed indicator if needed. Make the character hyper-detailed — simple low-poly anime figure is the goal. Add night mode or weather changes — keep it one warm afternoon. Max out GPU — test on RTX 4060

Gauntlet Loop: Builder agent builds the scene following this spec. Critic agent compares rendered frames against Studio Ghibli film stills and Makoto Shinkai background art. Run builder and critic sequentially, not in parallel.

What to Cut if it Gets Too Complex: Butterflies; Rice field water reflections; Character leg animation; Power lines; Painterly texture overlay; Multiple buildings; Road curves. Never cut: toon/cel shader, outlines, clouds, the character on a bicycle, trees, the sky gradient, third-person camera.

---

## What changed along the way

The brief was the starting point, not the fence. Across the iterations, at the user's request,
the scope grew past it:

- **On foot.** F gets her off the bike to walk the verges, the house lots and the paddy banks,
  with collisions and footsteps; F again gets back on, and out of reach the bike is wheeled over.
  The brief said "no dismount".
- **Cameras.** Cinematic tracking shots (C), a first-person view (V) and mouse look while riding.
- **Time of day.** Golden hour, sunset and dusk with lit windows, lanterns and fireflies, plus a
  40-second timelapse. The brief said "keep it one warm afternoon".
- **More of the countryside.** A shop street (dagashi shop, soba shop, vending machines, phone
  box, bus stop, vegetable stand), a torii with a wooded shrine path, jizo statues, birds, a far
  village and hills.
- **The bicycle.** A detailed mamachari (basket, chain case, dynamo lamp, spokes that blur with
  speed, kickstand, bell) instead of torus-and-cylinder geometry.
- **The rider.** Redesigned several times on request as a 20-year-old woman rather than a
  schoolgirl background figure, with a proper face, glasses, hair and clothes that move.
- **Hosting.** GitHub Pages instead of Vercel.
