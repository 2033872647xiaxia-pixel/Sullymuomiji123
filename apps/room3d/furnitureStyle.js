// Furniture-only experiment: clean color blocks, without pixelation or extra passes.
// Keep the existing geometry normals, alpha cutouts, shadows and emissive details.
// options.flat：卡通档——一刀切二值明暗（复古的三段色阶保持不变）。
export function applyRetroFurniture(material,lightUniforms,options) {
 if (!material.isMeshStandardMaterial) return;
 const flat=!!options?.flat;
 material.roughness = 0.82;
 material.metalness = 0;
 material.toneMapped = false;
 material.onBeforeCompile = shader => {
  if(lightUniforms)Object.assign(shader.uniforms,lightUniforms);
  shader.fragmentShader=(lightUniforms?'uniform vec3 roomShadeTint;\nuniform vec3 roomSunTint;\nuniform float roomBrightness;\nuniform float roomSunContrast;\n':'const vec3 roomShadeTint=vec3(.88,.92,1.);\nconst vec3 roomSunTint=vec3(1.,.97,.92);\nconst float roomBrightness=1.;\nconst float roomSunContrast=0.;\n')+shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace(
   'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
   `
   vec3 weights = vec3(0.2126, 0.7152, 0.0722);
   float base = max(dot(diffuseColor.rgb, weights), 0.001);
   float illumination = dot(totalDiffuse, weights) / base;
   ${flat ? `// 卡通档：一刀切二值明暗（窄 AA 防闪烁），软阴影随量化变成平色块。
   float shade = 0.68 + 0.32 * smoothstep(0.43, 0.47, illumination);` : `// Broad, gently joined steps keep curved furniture readable in motion.
   float shade = 0.74
     + 0.10 * smoothstep(0.28, 0.38, illumination)
     + 0.10 * smoothstep(0.55, 0.67, illumination)
     + 0.06 * smoothstep(0.88, 1.02, illumination);`}
   float daylight = smoothstep(0.8, 2.8, illumination);
   vec3 shadowTint = mix(roomShadeTint, roomSunTint, smoothstep(0.25, 1.3, illumination));
   // A restrained white reflection follows the actual lights and camera.
   // Cap it so the broad color blocks do not turn into glossy white plastic.
   float shaft = smoothstep(.12, .65, dot(reflectedLight.directDiffuse, weights) / base);
   shade = mix(shade, ${flat ? '0.70 + 0.22 * smoothstep(0.45, 0.49, illumination)' : '.62 + .24 * clamp(illumination,0.,1.)'} + shaft * .78, roomSunContrast);
   shadowTint = mix(shadowTint, mix(roomShadeTint, roomSunTint, shaft), roomSunContrast);
   daylight *= 1. - roomSunContrast;
   float reflection = min(dot(totalSpecular, weights), 0.035);
   // Retain the window projection above the last cel band. Previously it was
   // clipped to the same flat white as ordinary ambient illumination.
   vec3 outgoingLight = mix(diffuseColor.rgb * (shade + daylight * 0.3) * shadowTint * roomBrightness, vec3(1.0, 0.96, 0.83), reflection) + totalEmissiveRadiance;
   `);
 };
 material.customProgramCacheKey = () => 'retro-furniture-time-v5-'+!!lightUniforms+(flat?'-flat':'');
}

// Full-scene toon mode: reuse the cel shading above on walls/floors, and keep
// chaining on top of an existing onBeforeCompile (finish patterns inject into
// diffuseColor; cel shading replaces the outgoing light, so both coexist).
// Bind the captured handlers: the inherited Material.customProgramCacheKey
// reads this.onBeforeCompile, and calling it unbound would crash at render time.
export function applyToonEnvironment(material, lightUniforms) {
  if (!material.isMeshStandardMaterial) return;
  const previousCompile = material.onBeforeCompile?.bind(material);
  const previousKey = material.customProgramCacheKey?.bind(material);
  applyRetroFurniture(material, lightUniforms,{flat:true});
 const celCompile = material.onBeforeCompile;
  const celKey = material.customProgramCacheKey;
  material.onBeforeCompile = shader => { if (previousCompile) previousCompile(shader); celCompile(shader); };
  material.customProgramCacheKey = () => (previousKey ? previousKey() : '') + '/' + celKey();
}
