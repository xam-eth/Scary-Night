# Reference suitability — saw bench (`grimoire/intake/validation_rubric.md`)

**Verdict: pass.** One obvious object (bench + blade + log), ~78 % of the frame width, strong silhouette, materials visible (wood, steel, iron, end grain), hidden back inferable by symmetry, fully approximable with boxes, cylinders and one extruded toothed outline. No smoke, liquid, glass, logo or text. Target style: stylized low-poly to match the DUSKHOLD KayKit world.

## Floor shadow in the reference (added at the blockout pass)

The concept sits on a flat grey floor (#CBCBCB) with a soft shadow under the bench. The shadow is
darker than the Tier-1 mask threshold (RGB distance 24 from the background, about a 14-level grey
drop, alpha ~0.07), so the reference's own foreground mask includes it: floor pixels under the bench
read 150-188 against the 203 background (L 60-76 against 82). A shadow-free render therefore loses
that area in the silhouette IoU (0.822 at the first fit). Gate renders carry a matching contact
shadow instead of a key-light shadow (render-options.json): an ambient-occlusion floor decal derived
from the model's own height above the floor, blurred, offset slightly toward the back because the
concept's frontal key throws the shadow behind the bench. No light is involved, the orbit views stay
shadow-free, and the game uses its own shadows.
