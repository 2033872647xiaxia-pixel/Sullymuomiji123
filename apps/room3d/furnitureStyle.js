// Furniture-only experiment: clean color blocks, without pixelation or extra passes.
// Keep the existing geometry normals, alpha cutouts, shadows and emissive details.
// options.flat：卡通档——一刀切二值明暗（复古的三段色阶保持不变）。
export function applyRetroFurniture(material,lightUniforms,options) {
 if (!material.isMeshStandardMaterial) return;
 const flat=!!options?.flat;
 // 卡通档按原始材质特征分三档，各自的 cel 参数不同：
 // 金属（原 metalness>0.45）：硬高光 + 更深的明暗档；
 // 光滑硬材（陶瓷/玻璃/漆面/大理石，原 roughness<0.5）：保留亮反射、档位稍亮；
 // 哑光软材（布艺/原木/墙面）：维持原平涂与压死的反射。
 const metal=flat&&material.metalness>.45;
 const glossy=flat&&!metal&&material.roughness<.5;
 material.roughness = metal? .42 : glossy? .34 : 0.82;
 material.metalness = 0;
 material.toneMapped = false;
 material.onBeforeCompile = shader => {
  if(lightUniforms)Object.assign(shader.uniforms,lightUniforms);
  shader.fragmentShader=(lightUniforms?'uniform vec3 roomShadeTint;\nuniform vec3 roomSunTint;\nuniform float roomBrightness;\nuniform float roomSunContrast;\nuniform vec3 roomBounceUp;\nuniform vec3 roomBounceDown;\n':'const vec3 roomShadeTint=vec3(.88,.92,1.);\nconst vec3 roomSunTint=vec3(1.,.97,.92);\nconst float roomBrightness=1.;\nconst float roomSunContrast=0.;\nconst vec3 roomBounceUp=vec3(.95,.97,1.);\nconst vec3 roomBounceDown=vec3(1.,.94,.9);\n')+shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace(
   'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
   `
   vec3 weights = vec3(0.2126, 0.7152, 0.0722);
   float base = max(dot(diffuseColor.rgb, weights), 0.001);
   float illumination = dot(totalDiffuse, weights) / base;
   ${flat ? `// 卡通档：二值明暗（窄 AA 防闪烁），阈值按材质档位取——金属最深最硬，
   // 光滑硬材稍亮，软材维持原档。软阴影随量化变成平色块。
   float shade = ${metal ? '0.60 + 0.40 * smoothstep(0.40, 0.44, illumination)' : glossy ? '0.72 + 0.28 * smoothstep(0.36, 0.40, illumination)' : '0.68 + 0.32 * smoothstep(0.43, 0.47, illumination)'};` : `// Broad, gently joined steps keep curved furniture readable in motion.
   float shade = 0.74
     + 0.10 * smoothstep(0.28, 0.38, illumination)
     + 0.10 * smoothstep(0.55, 0.67, illumination)
     + 0.06 * smoothstep(0.88, 1.02, illumination);`}
   float daylight = smoothstep(0.8, 2.8, illumination);
   vec3 shadowTint = mix(roomShadeTint, roomSunTint, smoothstep(0.25, 1.3, illumination));
   // 漫反射：阴影带按表面朝向染天空反弹/地面反弹色（朝上偏冷、朝下偏暖），
   // 不同朝向的暗面颜色有呼吸感，不再是同一块死色。
   // 金属暗面吃更多环境反弹色（冷调明显），硬材次之，软材最弱。
   vec3 shadeNormal = normalize(vec3(dot(viewMatrix[0].xyz,normal),dot(viewMatrix[1].xyz,normal),dot(viewMatrix[2].xyz,normal)));
   shadowTint = mix(shadowTint, mix(roomBounceDown,roomBounceUp,shadeNormal.y*.5+.5), ${metal?'.70':glossy?'.55':'.45'});
   // A restrained white reflection follows the actual lights and camera.
   // Cap it so the broad color blocks do not turn into glossy white plastic.
   float shaft = smoothstep(.12, .65, dot(reflectedLight.directDiffuse, weights) / base);
   shade = mix(shade, ${flat ? '0.70 + 0.22 * smoothstep(0.45, 0.49, illumination)' : '.62 + .24 * clamp(illumination,0.,1.)'} + shaft * .78, roomSunContrast);
   shadowTint = mix(shadowTint, mix(roomShadeTint, roomSunTint, shaft), roomSunContrast);
   daylight *= 1. - roomSunContrast;
   // 金属保留锐利高光点（硬反射），光滑硬材留一线亮反光，软材照旧压死。
   float reflection = min(dot(totalSpecular, weights), ${metal?'.30':glossy?'.09':'0.035'});
   // Retain the window projection above the last cel band. Previously it was
   // clipped to the same flat white as ordinary ambient illumination.
   vec3 outgoingLight = mix(diffuseColor.rgb * (shade + daylight * 0.3) * shadowTint * roomBrightness, vec3(1.0, 0.96, 0.83), reflection) + totalEmissiveRadiance;
   `);
 };
 material.customProgramCacheKey = () => 'retro-furniture-time-v6-'+!!lightUniforms+(flat?'-flat':'')+(metal?'-metal':glossy?'-glossy':'');
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
