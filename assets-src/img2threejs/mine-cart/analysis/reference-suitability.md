# Reference suitability — mine cart (img2threejs `grimoire/intake/validation_rubric.md`)

**Verdict: pass** (with the stylization note below).

- One obvious target object (the cart on its rail section), centered, about 70 % of the frame.
- Strong silhouette: tapered tub, heaped ore, four wheels, rear handle, rails.
- Major materials visible: wood, iron, gold ore, gravel bed.
- Hidden side (right long side, rear end, floor, axles) can be inferred from bilateral symmetry.
- Approximable with procedural primitives: boxes/frusta, cylinders, tori, extruded profiles, low-poly icosahedra for nuggets.
- Not smoke, liquid, glass or lace; no brand, logo or text.

Conditional notes:
- Single view only; the hidden right side and rear are mirrored/inferred (low confidence on rivet counts).
- Target style is stylized low-poly to match DUSKHOLD's KayKit world; the illustration's painted wood grain and gradients are not reproduced one-to-one (flat stylized albedo + vertex-colour accents).
