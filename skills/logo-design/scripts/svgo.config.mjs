// SVGO config for logo masters (SoloSquad, logo-design skill).
// Use the pinned version:  npx --yes svgo@4.0.0 --config scripts/svgo.config.mjs in.svg -o out.svg
// SVGO 4's preset-default no longer removes viewBox or <title>. This config never adds removeViewBox,
// and removeDimensions replaces width/height with a viewBox, so the mark always scales.
// Run svg_audit.py on the result: optimisation must not change the drawing.
export default {
  multipass: true,
  floatPrecision: 2,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          cleanupIds: false, // readable ids for lockups and motion work
          convertShapeToPath: false, // circles/rects stay editable primitives
          removeDesc: false, // keep licence / designer notes
        },
      },
    },
    'removeDimensions', // width/height -> viewBox only (never deletes the viewBox)
    { name: 'removeAttrs', params: { attrs: ['data-name'] } },
  ],
};
