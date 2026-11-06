// `office-asset:<file>.glb` → the URL of that GLB in the build (vite.config.ts `officeAssets`):
// assets/office/export/<file> when the Blender session has delivered it, else the placeholder.
declare module 'office-asset:*' {
  const url: string;
  export default url;
}
