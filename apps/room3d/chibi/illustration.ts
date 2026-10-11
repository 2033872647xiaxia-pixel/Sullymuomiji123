import * as T from 'three';
import { dropShadowUniforms } from './dropShadow';

// A single material pass: retain painted features, cutout hair, skinning and
// garment colours, but replace physical highlights with two painted tones.
// Standalone previews use a fixed illustration light; homes bind their shared
// lighting uniforms and receive the room shadows in the existing material pass.
const originals = new WeakMap<T.MeshStandardMaterial, {
  compile: T.MeshStandardMaterial['onBeforeCompile'];
  cache: T.MeshStandardMaterial['customProgramCacheKey'];
  toneMapped: boolean;
}>();
type RoomLightUniforms = {roomShadeTint:{value:T.Color};roomSunTint:{value:T.Color};roomBrightness:{value:number};roomSunContrast:{value:number}};
const roomTints = new WeakMap<T.MeshStandardMaterial, {value:T.Color}>();
const roomLights = new WeakMap<T.MeshStandardMaterial, {enabled:{value:number}; uniforms:RoomLightUniforms; cel:{value:number}}>();
// 主光方向（视野空间，表面→光），脸部 SDF 阴影的横向扫动阈值用；由家园编辑器每帧刷新。
export const characterLightDirection={value:new T.Vector3(0,0,1)};

export function setCharacterRoomLighting(root:T.Object3D,uniforms:RoomLightUniforms,cel=false){
 root.traverse(object=>{
  if(!(object instanceof T.Mesh))return;
  object.receiveShadow=true;
  for(const material of Array.isArray(object.material)?object.material:[object.material]){
   if(!(material instanceof T.MeshStandardMaterial))continue;
   const room=roomLights.get(material);if(!room)continue;
   const celValue=cel?1:0;
   if(room.uniforms===uniforms){if(room.cel.value!==celValue)room.cel.value=celValue;continue;}
   room.enabled.value=1;room.uniforms=uniforms;room.cel.value=celValue;material.needsUpdate=true;
  }
 });
}

// Keep faces legible while giving all residents the same room colour cast.
// Standalone avatar previews keep a neutral tint.
export function setCharacterRoomTint(root:T.Object3D,color:string){
 root.traverse(object=>{
  if(!(object instanceof T.Mesh))return;
  for(const material of Array.isArray(object.material)?object.material:[object.material]){
   if(!(material instanceof T.MeshStandardMaterial))continue;
   const tint=roomTints.get(material);if(tint)tint.value.set(color);
  }
 });
}

export function setCharacterIllustration(root:T.Object3D, enabled=true) {
  const seen = new Set<T.Material>();
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof T.MeshStandardMaterial) || seen.has(material)) continue;
      seen.add(material);
      const original = originals.get(material);
      if (!enabled) {
        if (!original) continue;
        material.onBeforeCompile = original.compile;
        material.customProgramCacheKey = original.cache;
        material.toneMapped = original.toneMapped;
        originals.delete(material);
        roomTints.delete(material);
        roomLights.delete(material);
      } else {
        if (original) continue;
        const saved = {compile:material.onBeforeCompile, cache:material.customProgramCacheKey, toneMapped:material.toneMapped};
        const cacheKey = material.customProgramCacheKey();
        originals.set(material,saved);
        const roomTint={value:new T.Color('#ffffff')};roomTints.set(material,roomTint);
        const room={enabled:{value:0},uniforms:{roomShadeTint:{value:new T.Color('#ffffff')},roomSunTint:{value:new T.Color('#ffffff')},roomBrightness:{value:1},roomSunContrast:{value:0}},cel:{value:0}};roomLights.set(material,room);
        const faceSdf = material.userData.faceSdf as T.Texture | undefined;
        material.toneMapped = false;
        material.onBeforeCompile = (shader,renderer) => {
          saved.compile.call(material,shader,renderer);
          shader.uniforms.characterRoomTint=roomTint;
          shader.uniforms.characterRoomEnabled=room.enabled;
          shader.uniforms.characterCel=room.cel;
          shader.uniforms.dropShadowMask=dropShadowUniforms.mask;
          shader.uniforms.dropShadowScreen=dropShadowUniforms.screen;
          shader.uniforms.dropShadowDrop=dropShadowUniforms.drop;
          shader.uniforms.dropShadowEnabled=dropShadowUniforms.enabled;
          if(faceSdf){shader.uniforms.faceSdfMap={value:faceSdf};shader.uniforms.characterLightDirection=characterLightDirection;}
          Object.assign(shader.uniforms,room.uniforms);
          shader.fragmentShader='uniform vec3 characterRoomTint;\nuniform float characterRoomEnabled;\nuniform float characterCel;\nuniform sampler2D dropShadowMask;\nuniform vec2 dropShadowScreen;\nuniform vec2 dropShadowDrop;\nuniform float dropShadowEnabled;\n'+(faceSdf?'uniform sampler2D faceSdfMap;\nuniform vec3 characterLightDirection;\n':'')+'uniform vec3 roomShadeTint;\nuniform vec3 roomSunTint;\nuniform float roomBrightness;\nuniform float roomSunContrast;\n'+shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace(
            'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
            `
            vec3 inkLight = normalize(mat3(viewMatrix) * vec3(-0.45, 0.8, 0.65));
            float inkFacing = dot(normal, inkLight);
            float inkEdge = max(fwidth(inkFacing) * 1.5, 0.012);
            float inkLit = smoothstep(0.12 - inkEdge, 0.12 + inkEdge, inkFacing);
            float inkShade = mix(${material.userData.illustrationFace ? '0.90' : '0.70'}, 1.0, inkLit);
            vec3 inkTint = mix(vec3(0.96, 0.97, 1.0), vec3(1.0), inkLit);
            vec3 inkPreview = diffuseColor.rgb * inkShade * inkTint * characterRoomTint;
            vec3 inkWeights = vec3(.2126,.7152,.0722);
            float inkBase = max(dot(diffuseColor.rgb,inkWeights),.001);
            float inkEnergy = dot(totalDiffuse,inkWeights)/inkBase;
            // directDiffuse includes window occlusion and the actual light direction.
            float inkDirect = dot(reflectedLight.directDiffuse,inkWeights)/inkBase;
            float inkSun = smoothstep(.18,.85,inkDirect);
            float inkRoomShade = mix(${material.userData.illustrationFace ? '.84' : '.68'},1.0,smoothstep(.18,.82,inkEnergy));
            // Toon rooms: snap the smooth ramp to the same hard cel bands the
            // environment shader uses, so residents sit inside the scene's
            // shading instead of floating above it. Faces keep a higher floor
            // and gentler steps to stay legible.
            float celBand = ${material.userData.illustrationFace ? '.86' : '.74'}
              + ${material.userData.illustrationFace ? '.05' : '.10'} * smoothstep(.28,.38,inkEnergy)
              + ${material.userData.illustrationFace ? '.04' : '.10'} * smoothstep(.55,.67,inkEnergy)
              + ${material.userData.illustrationFace ? '.05' : '.06'} * smoothstep(.88,1.02,inkEnergy);
            inkRoomShade = mix(inkRoomShade, celBand, characterCel);
            inkRoomShade += inkSun * mix(.12,${material.userData.illustrationFace ? '.30' : '.38'},roomSunContrast);
            ${material.userData.faceSdf ? `
            // 脸部 SDF 阴影：距离场由前发部件生成（FbxBody / faceSdf.ts），边界跟随
            // 刘海下缘。阈值随主光横向扫动偏移——光从哪边来，影带向对侧加深；
            // 刘海覆盖区内（含透视缝隙）场值为负，任何阈值下都是影。
            float faceField = texture2D(faceSdfMap, vMapUv).r * 2.0 - 1.0;
            vec3 faceRight = normalize(cross(vec3(0.,1.,0.), normal));
            float faceSweep = clamp(dot(characterLightDirection, faceRight), -1., 1.);
            float faceCut = 0.06 + 0.55 * faceSweep * (0.5 - vMapUv.x);
            float faceAa = max(fwidth(faceField) * 1.5, 0.02);
            float faceShadow = (1.0 - smoothstep(faceCut - faceAa, faceCut + faceAa, faceField)) * characterCel;
            inkRoomShade = mix(inkRoomShade, .80, faceShadow);` : material.userData.illustrationFace || material.userData.illustrationSkin ? `
            // 屏幕空间落影（前发/衣片 → 脸与皮肤）：按主光方向偏移采样剪影蒙版，
            // 命中处直接压进阴影档，颜色随下方的偏色一起换。无 SDF 的脸部走这条兜底。
            float dropMask = dropShadowEnabled > .5
              ? smoothstep(.35,.65,texture2D(dropShadowMask,(gl_FragCoord.xy/dropShadowScreen)+dropShadowDrop).a)
              : 0.0;
            inkRoomShade = mix(inkRoomShade, ${material.userData.illustrationFace ? '.80' : '.78'}, dropMask);` : ''}
            vec3 inkRoomTint = mix(roomShadeTint,roomSunTint,inkSun);
            vec3 inkRoom = diffuseColor.rgb * inkRoomShade * inkRoomTint * roomBrightness;
            // 卡通阴影偏色：阴影档不压黑，而是整体向玫瑰→紫的方向换色（脸部更轻）。
            float celDepth = clamp((1.0 - inkRoomShade) * 1.6, 0.0, 1.0);
            inkRoom *= mix(vec3(1.0), ${material.userData.illustrationFace ? 'vec3(.97,.93,1.04)' : 'vec3(.93,.87,1.08)'}, celDepth * characterCel);
            ${material.userData.illustrationFace ? '' : `
            // 边缘光：只出现在背光侧的硬边亮带（脸部不加，保持画面干净）。
            float inkGrazing = 1.0 - abs(dot(normal, normalize(vViewPosition)));
            float inkRim = smoothstep(.70,.76,inkGrazing) * (1.0 - smoothstep(.10,.22,inkEnergy));
            inkRoom = mix(inkRoom, (diffuseColor.rgb * 1.10 + vec3(.07)) * inkRoomTint, inkRim * characterCel);`}
            vec3 outgoingLight = mix(inkPreview,inkRoom,characterRoomEnabled);
            `,
          );
        };
        material.customProgramCacheKey = () => cacheKey + '-character-illustration-v3-' + (material.userData.illustrationFace ? (material.userData.faceSdf ? 'face-sdf' : 'face') : material.userData.illustrationSkin ? 'skin' : 'body');
      }
      material.userData.characterIllustration = enabled;
      material.needsUpdate = true;
    }
  });
}
