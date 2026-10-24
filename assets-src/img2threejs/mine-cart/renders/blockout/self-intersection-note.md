# self_intersection.py on the blockout meshes

`self_intersection.py` flagged 2 of 79 vertices on "Push grip" and 2 of 187 on "Ore heap"
(insideVertexCount 4 of 1214 sampled, every mesh sampled, stride 1).

Both meshes are three.js analytic primitives (an endpoint CylinderGeometry, 8 radial segments, and
a SphereGeometry, 16 x 10), which are convex and cannot fold through themselves. Independent check:
for every triangle plane of each mesh (oriented away from the centroid), every vertex lies on the
inner side — grip: 80 planes, 0 violations; heap: 288 planes, 8 violations of at most 1.3e-5
(the 5-decimal rounding of the exported coordinates). The flagged vertices sit in symmetric
pairs (index 14/28 on the grip, 54/130 on the heap), the signature of a parity ray grazing an
edge of a faceted convex surface rather than of a fold.

Verdict: a ray-parity false positive on convex primitives, recorded here rather than silenced; no
geometry change. The gate stays in the evidence set for every later pass.
